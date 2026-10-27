# Compatibility

Validated environment: GNOME Shell 50.6 / Wayland, Bazzite 44.

| Application | Tested version/package | Current integration |
| --- | --- | --- |
| Nautilus | 50.4-1.fc44, RPM | Partial application/window commands |
| Ptyxis | 50.1-2.fc44, RPM | Partial application commands and tab read-only state |
| Other GTK applications | No individual guarantee | Generic exported commands and supported typed targets, plus conventional application actions |
| Exported GMenu | Integration fixtures | Imported original menu model |
| Signal, Obsidian, Firefox | Pending | No supported integration claimed |

## Partial menus

The tested Nautilus and Ptyxis builds export action groups without publishing a complete menu model. GnoMenu constructs a translated presentation of compatible exported commands and marks it **Partial menu**.

Nautilus exposes preferences, about/quit, window/tab operations, duplicate window, closing other tabs, moving tabs, undo/redo, sidebar, transfers, home and help commands when those actions exist. Ptyxis exposes preferences/about, new window/tab, default-terminal registration and the current tab's read-only state.

Additional exported actions appear under **Additional Commands**. GnoMenu includes parameterless commands and boolean parameter choices. Other parameter types require an explicit finite set of accepted values; the current string or integer state does not establish the complete choices. The standard D-Bus action protocol does not transmit GAction state hints, so those hints are usually unavailable remotely. Non-boolean state-only exports are omitted because they can represent status counters rather than commands.

Selection commands, copy/paste and other internal commands may remain available only in the applications themselves. These require further application/exporter integration; enumeration cannot expose actions the application keeps private.

## Desktop fallback

On the desktop or in an app without captured commands, the panel shows the last active Files window and retains its exact D-Bus window paths. Commands continue to reach that Files window. An installed Files application with no window supplies New Window and Home launchers instead. Without Files installed, the panel shows Desktop. The extension's own name is never the desktop title.

## Local-menu ownership

A complete imported menubar can take ownership of a local menu when the application publishes an enabled boolean window action named `show-menubar`, `show-menu-bar` or `menubar-visible`. Capture changes that action's state to false and restores its original value on release, disposal or extension disable. Windows originally hiding their menubar remain hidden. Truncated imports release ownership.

This is verified with the real GTK fixture's `Gtk.ApplicationWindow.show-menubar` property. Nautilus and Ptyxis do not export this visibility control in the tested versions, so their partial adapters keep the local UI available. Arbitrary hamburger menus, selection toolbars and Electron controls cannot be hidden through GMenu or GAction enumeration.

GTK4 deprecated [`gtk-shell-shows-menubar`](https://docs.gtk.org/gtk4/property.Settings.gtk-shell-shows-menubar.html) in 4.20 as no longer relevant. Mutter 50.6's [GTK shell implementation](https://github.com/GNOME/mutter/blob/50.6/src/wayland/meta-wayland-gtk-shell.c) advertises the app-menu capability based on fallback-app-menu preferences; this does not supply a per-window global-menubar hiding API for the extension.

Application paths and unique bus names come from the Mutter window's GTK metadata. Application names and PIDs are not used to guess a target window.

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
- Focusing an unsupported fixture application keeps the real Files fallback.

The accessibility observer is test infrastructure. The runtime extension does not require enabling a screen reader or accessing the desktop accessibility tree.

Results and captures are generated locally under `reports/`.

## Desktop versus development window

The development window has its own compositor and session bus. An application launched on the normal desktop is outside that session.

Use `python3 tools/install-local.py` to install for the current user, then log out and back in to load a new local extension. The installer preserves other extensions and never logs the user out automatically.
