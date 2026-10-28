// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
const {app, BrowserWindow, Menu, MenuItem} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.GNOMENU_ELECTRON_WORKSPACE;
if (!root || !path.isAbsolute(root))
    throw new Error('This fixture requires its private test workspace');
app.setName('GnoMenu Electron Fixture');
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'session'));
app.disableHardwareAcceleration();
const records = [];
const windows = [];
function save() {
    const state = {electron: process.versions.electron, pid: process.pid,
        backend: process.env.GNOMENU_ELECTRON_BACKEND,
        fixturePath: path.relative(root, app.getAppPath()),
        profilePath: path.relative(root, app.getPath('userData')), windows: records};
    fs.writeFileSync(path.join(root, 'electron-state.tmp'), JSON.stringify(state));
    fs.renameSync(path.join(root, 'electron-state.tmp'), path.join(root, 'electron-state.json'));
    for (const [index, window] of windows.entries()) {
        if (!window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
            const record = records[index];
            const text = `Window ${index + 1} · Commands received: ${record.counter} · Checked: ${record.checked ? 'on' : 'off'}`;
            window.webContents.executeJavaScript(`document.getElementById('state').textContent = ${JSON.stringify(text)}`).catch(() => {});
        }
    }
}
app.whenReady().then(async () => {
    for (let index = 0; index < 2; index++) {
        const record = {index, counter: 0, dynamic: false, checked: false, closed: false};
        records.push(record);
        const window = new BrowserWindow({width: 500, height: 320, x: 30 + index * 520, y: 100,
            title: 'GnoMenu Electron Fixture', webPreferences: {sandbox: true, nodeIntegration: false, contextIsolation: true}});
        windows.push(window);
        window.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']},
            (_details, callback) => callback({cancel: true}));
        const menu = Menu.buildFromTemplate([{label: 'File', submenu: [
            {label: 'Increment this window', click: () => {record.counter++; save();}},
            {label: 'Disabled command', enabled: false, click: () => {record.counter += 100; save();}},
            {label: 'Tools', submenu: [
                {label: 'Nested increment', click: () => {record.counter++; save();}},
            ]},
            {label: 'Add dynamic command', click: () => {
                if (!record.dynamic) {
                    record.dynamic = true;
                    menu.items[0].submenu.append(new MenuItem({label: 'Dynamic command', click: () => {record.counter++; save();}}));
                    window.setMenu(menu);
                    save();
                }
            }},
            {label: 'Close this window', click: () => window.close()},
        ]}, {label: 'View', submenu: [
            {label: 'Checked option', type: 'checkbox', click: item => {record.checked = item.checked; save();}},
        ]}]);
        window.setMenu(menu);
        await window.loadURL('data:text/html,' + encodeURIComponent('<title>GnoMenu Electron Fixture</title>' +
            '<body style="font:18px sans-serif;padding:24px"><h1>GnoMenu Electron</h1>' +
            `<p id="state">Window ${index + 1} · Commands received: 0 · Checked: off</p>` +
            '<p>Use File and View in the top panel.</p></body>'));
        const handle = window.getNativeWindowHandle();
        record.nativeHandleHex = handle.toString('hex');
        if (process.env.GNOMENU_ELECTRON_BACKEND === 'x11')
            record.xid = handle.readUInt32LE(0);
        window.on('closed', () => {record.closed = true; save();});
        save();
    }
    console.log('GNOMENU_ELECTRON_READY');
});
app.on('window-all-closed', () => app.quit());
if (process.env.GNOMENU_ELECTRON_INTERACTIVE !== '1')
    setTimeout(() => app.quit(), 60000);
