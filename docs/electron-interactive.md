# Interactive Electron prototype

Open a private GNOME Shell desktop in Mutter Development Kit:

```bash
cd ~/Projects/gnome-global-menu-research
/usr/bin/python3 tools/dev-electron.py
```

The default runtime is the installed Obsidian Flatpak's Electron core. Only the core is staged; Obsidian application archives, vaults and profiles are excluded. To choose a compatible Electron ELF that permits directory applications, pass `--runtime /absolute/path/to/core`.

This command creates a separate session bus, home, configuration, XWayland server, registrar and fixture profile. It uses the existing `mutter-devkit` executable, falling back to `build/deps/devkit/usr/libexec/mutter-devkit`. If that optional viewer is missing, use the project's existing `tools/bootstrap-devkit.py` workflow. PipeWire video connects through the outer desktop's runtime socket so the development window can display the private monitor.

## Try it

1. Focus either of the two Electron windows. Their body text identifies Window 1 or Window 2 and shows its command count.
2. Use **File → Increment this window**, then **File → Tools → Nested increment**. Only that window's counter should increase.
3. Choose **File → Add dynamic command**. Reopen File and invoke the new **Dynamic command**.
4. Switch windows and repeat. Commands, counters and imported models should remain separate. The disabled command should stay unavailable.
5. Try View's checkbox. The body reports the actual callback state; the native exporter's known stale checkbox advertisement may leave the panel ornament unchecked. That existing mismatch is not fixed by this demo.
6. Close one fixture window and continue using the remaining one. Close the outer Mutter Development Kit window, close both fixtures, or press Ctrl+C in the launching terminal to finish.

The interactive bridge consumes the independent XRes/D-Bus identity report before publishing temporary GTK metadata. It does not run the automatic command sequence or increment counters on startup. Lazy menus are prepared by actual panel opening. The viewer and fixture stay open until you finish; the automatic fixture's 60-second timeout is disabled in this mode.

Smoke-check the launch/cleanup path with:

```bash
/usr/bin/python3 tools/dev-electron.py --duration 8
```

Logs and final state are written to `reports/electron-demo/x11/`. The duration option is for launch/cleanup verification, not a substitute for manual input testing. Closing the viewer before the requested smoke duration is treated as failure. The default headless verifier remains `tools/verify-electron.py` and keeps separate reports under `reports/electron-export/`.

This exposes the controlled X11 fixture only. It does not enable vendor application support, native Wayland menu export or an installed companion. The regular desktop's GNOME extension and application settings are unchanged. Local-menu removal, Flatpak proxies and continuous third-party identity validation remain separate work.
