# Compatibility

Validated environment: GNOME Shell 50.6 / Wayland, Bazzite 44.

| Application | Tested version/package | Current integration |
| --- | --- | --- |
| Nautilus | 50.4-1.fc44, RPM | Partial application/window commands |
| Ptyxis | 50.1-2.fc44, RPM | Partial application commands and tab read-only state |
| Other GTK applications | No individual guarantee | Original exported menu models and conventional application actions |
| Exported GMenu | Integration fixtures | Imported original menu model |
| Signal, Obsidian, Firefox | Pending | No supported integration claimed |

## Partial menus

The tested Nautilus and Ptyxis builds export action groups without publishing a complete menu model. GnoMenu constructs a translated presentation of compatible exported commands and marks it **Partial menu**.

Nautilus exposes preferences, about/quit, window/tab operations, duplicate window, closing other tabs, moving tabs, undo/redo, sidebar, transfers, home and help commands when those actions exist. Ptyxis exposes preferences/about, new window/tab and the current tab's read-only state.

Original menu models supply the labels, order, sections, nesting and typed targets used by native imports. An exported action list supplies none of that layout information. GnoMenu does not turn unknown action identifiers into menu captions, invent a catch-all menu, or guess their placement. Unplaced actions such as Nautilus's `kill` and `current-location-menu` are not exposed as standalone global-menu entries.

The Nautilus/Ptyxis adapters remain a partial presentation of known commands, not a reconstruction of their complete local menu hierarchy. Complete import needs an application/toolkit exporter that publishes the real menu model and the corresponding actions. Menu layouts cannot be recovered reliably from a GAction inventory alone.

An optional [native Nautilus exporter experiment](native-exporter.md) now captures the real toolbar, tab, breadcrumb, selection and background menu models with their actions. Tab commands retain their page; breadcrumb commands use a generation per click; file-context commands retain a selection/location snapshot and retire on effective changes. It is verified in a private harness with two windows and two locales; it is outside the extension ZIP and does not change the default integration described above. Broad file-type coverage, destructive operations, additional tab/breadcrumb commands and regular-desktop deployment remain pending.

Selection commands, copy/paste and other internal commands may remain available only in the applications themselves. These require further application/exporter integration; enumeration cannot expose actions the application keeps private.

## Desktop fallback

Every focused app retains its own name, even when it exports no compatible commands. Such an app displays a localized unavailable status and never inherits Files commands or launchers.

On the desktop, with no app focused, the panel shows the last active Files window and retains its exact D-Bus window paths. Commands continue to reach that Files window. When every Files window closes, File, Edit, View, Go and Help remain visible using the same partial adapter. New Window and Home invoke launchers; window-dependent commands such as New Tab, Close Tab and Undo remain disabled. Published application commands can still run without a client window. If Files stops, its application commands become disabled while the categories and launchers remain. No process is started or hidden window created automatically.

This persistent desktop layout is the existing explicit partial adapter, not a newly exported native menu model. Without Files installed, the desktop panel shows Desktop. The extension's own name is never the desktop title.

## Local-menu ownership

A complete imported menubar can take ownership of a local menu when the application publishes an enabled boolean window action named `show-menubar`, `show-menu-bar` or `menubar-visible`. Capture changes that action's state to false and restores its original value on release, disposal or extension disable. Windows originally hiding their menubar remain hidden. Truncated imports release ownership.

This is verified with the real GTK fixture's `Gtk.ApplicationWindow.show-menubar` property. Nautilus and Ptyxis do not export this visibility control in the tested versions, so their partial adapters keep the local UI available. Arbitrary hamburger menus, selection toolbars and Electron controls cannot be hidden through GMenu or GAction enumeration.

GTK4 deprecated [`gtk-shell-shows-menubar`](https://docs.gtk.org/gtk4/property.Settings.gtk-shell-shows-menubar.html) in 4.20 as no longer relevant. Mutter 50.6's [GTK shell implementation](https://github.com/GNOME/mutter/blob/50.6/src/wayland/meta-wayland-gtk-shell.c) advertises the app-menu capability based on fallback-app-menu preferences; this does not supply a per-window global-menubar hiding API for the extension.

Window-source paths and unique bus names come from the Mutter window's GTK metadata. The windowless desktop source watches the Files application's published bus name without auto-starting it, pins its unique owner and imports the application action group at `/org/gnome/Nautilus`. It does not claim a client window. Application names and PIDs are not used to guess a target window.

## Real-application verification

```bash
python3 tests/run-shell.py --real-apps
python3 tests/run-shell.py --real-apps --locale pt_BR.UTF-8
```

The harness opens two real windows per application in a private GNOME session:

- Nautilus browses empty temporary directories.
- Ptyxis runs `sleep` instead of loading shell startup files.
- Nautilus New Tab/Close Tab effects are observed through a private AT-SPI bus.
- Ptyxis read-only state changes only in the selected window and is restored.
- Application preferences and compatible exported commands are present.
- Disabling GnoMenu disposes its sources and panel actors.
- Minimizing windows retains Files on the desktop, where New Tab still reaches the remembered window.
- Closing every Files window keeps all desktop categories visible and disables window-dependent commands.
- An unsupported focused fixture retains its own name even while Files is running, without inheriting Files commands.

The accessibility observer is test infrastructure. The runtime extension does not require enabling a screen reader or accessing the desktop accessibility tree.

Results and captures are generated locally under `reports/`.

## Desktop versus development window

The development window has its own compositor and session bus. An application launched on the normal desktop is outside that session.

Use `python3 tools/install-local.py` to install for the current user, then log out and back in to load a new local extension. The installer preserves other extensions and never logs the user out automatically.
