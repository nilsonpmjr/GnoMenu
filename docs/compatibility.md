# Compatibility

Validated environment: GNOME Shell 50.6 / Wayland, Bazzite 44.

| Application | Tested version/package | Current integration |
| --- | --- | --- |
| Nautilus | 50.4-1.fc44, RPM | Partial application/window commands |
| Ptyxis | 50.1-2.fc44, RPM | Partial application commands and tab read-only state |
| Other GTK applications | No individual guarantee | Conventional preferences/about/quit actions when exported |
| Exported GMenu | Integration fixtures | Imported original menu model |
| Signal, Obsidian, Firefox | Pending | No supported integration claimed |

## Partial menus

The tested Nautilus and Ptyxis builds export action groups without publishing a complete menu model. GnoMenu constructs a translated presentation of compatible exported commands and marks it **Partial menu**.

Nautilus exposes preferences, about/quit, window/tab operations, undo/redo, sidebar, transfers, home and help commands when those actions exist. Ptyxis exposes preferences/about, new window/tab and the current tab's read-only state.

Selection commands, copy/paste and other internal commands may remain available only in the applications themselves. GnoMenu keeps local menus intact. It does not invent actions or guess required parameters.

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

The accessibility observer is test infrastructure. The runtime extension does not require enabling a screen reader or accessing the desktop accessibility tree.

Results and captures are generated locally under `reports/`.

## Desktop versus development window

The development window has its own compositor and session bus. An application launched on the normal desktop is outside that session.

Use `python3 tools/install-local.py` to install for the current user, then log out and back in to load a new local extension. The installer preserves other extensions and never logs the user out automatically.
