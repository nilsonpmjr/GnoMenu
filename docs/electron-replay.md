# Controlled Electron menu replay

The replay runs GnoMenu's own application fixture in a staged copy of an installed Electron core. It does not run Signal/Obsidian application code, access their profiles or change their Flatpak permissions. This establishes protocol behavior and private panel rendering for one runtime, not vendor application support or normal companion installation.

## Observed result

Electron `43.8.3`, GNOME Shell `50.6`, Wayland compositor with a private XWayland server. Core ELF SHA-256: `d1789e4e4d51885a5500dd30fe141cf732d03f78c87541f1552972ab277cbb5c`. Both backend cases use those same bytes.

| Case | Observation | Scope |
| --- | --- | --- |
| XWayland | Two distinct native handles register two menubars through one unique D-Bus owner, with distinct object paths | Both windows have identical titles and the same PID. Discovery uses the fixture's actual native handles, not titles or PIDs. Private X11 property reads corroborate those selected handles. |
| Lazy menus | File and View populate through `AboutToShow` | Looking only at the initial layout misses real commands. |
| Invocation | Each menu increments only its own window's counter; a disabled command is rejected | GnoMenu's existing `AppMenuDiscovery` and `DBusMenuSource` are used directly. |
| GTK association and bridge | Temporary standard X11 GTK properties give each actual Meta window a distinct GMenu/action descriptor. Every exported fixture entry crosses the bridge; imported commands reach only the originating native window | Production `sourceForWindow` and `GMenuSource` are exercised. The companion uses each pinned DBusMenu descriptor and preserves its hierarchy. Cleanup removes its properties/exports and rejects disposed commands. |
| Actual Shell panel | Native headings, lazy nested contents and dynamic commands are displayed and invoked in the real panel; focus changes and explicit closure remain authoritative | The production renderer runs on a private desktop. Input uses actor APIs, not physical or virtual mouse/keyboard events. Fixture-provided handles establish identity only for this controlled application. See [panel checks](electron-panel.md). |
| Checkbox | Its native callback changes the selected window's checked value, while the server still advertises `toggle-state=0` after reopening and a 500ms wait | The imported unchecked state agrees with raw `GetLayout`. This is a recorded synchronization gap, not a passing claim for checkbox state fidelity. No local state is invented to conceal the mismatch. |
| Dynamic layout | A bridged command triggers native model replacement. Standard exported submenu actions prepare the new contents; the new command is imported and invoked through both protocols | The other window's menu remains unchanged. Old-generation imported commands are rejected. |
| Window close | The first declaration is withdrawn, its source is disposed and its old command is rejected; the remaining window's menu still works | Discovery withdrawal is checked independently after the panel bridge experiment has been cleaned up. Arbitrary third-party companion lifetime handling remains pending. |
| Native Wayland | Two actual Wayland windows, no registrar declarations during the recorded interval of at least three seconds | The returned native handles are opaque values and are never coerced into XIDs. This is bounded to this runtime, fixture and interval. |

Fifteen XWayland check groups and two Wayland observation groups pass. Shell logs are also checked for JavaScript, GJS, Clutter and St critical errors. Passing the replay means those declared checks completed; it does not certify full menu-state fidelity, support for vendor applications or universal Wayland behavior.

## Why vendor integration is still pending

The inspected `Meta.Window` objects expose an internal ID different from the XID and do not expose `get_xwindow`. The [GTK property experiment](window-association.md#standard-gtk-property-association-probe) validates a narrow association path using the fixture's exact native handles, without parsing descriptions. The [full-model bridge](menu-bridge.md) and [private production panel](electron-panel.md) now run through that path. Arbitrary third-party identity/lifecycle handling, companion installation and actual vendor/Flatpak tests remain pending.

The registrar starts only on the private session bus. GnoMenu does not claim the registrar name in the regular desktop, force a backend change or hide a third-party local menu as part of this experiment. Native Wayland needs a cooperative association/export path. Flatpak permissions and the actual vendor application lifecycle require separate tests.

## Runtime staging

The core ELF is copied byte-for-byte into a temporary directory, alongside selected core data/libraries. Only `fixtures/electron-menu` is installed as its application. Vendor ASARs, unpacked Node addons and user settings are excluded. The fixture records and checks its application path and temporary profile path, uses local data content and blocks HTTP/HTTPS/WebSocket requests. The replay is not a network sandbox or a system-wide filesystem trace.

REA fuse inspection found the selected Obsidian core permits directory applications. Its Node Inspector arguments, `NODE_OPTIONS` and RunAsNode fuses are disabled. Signal's inspected core additionally restricts application loading to ASAR. No fuse is modified, and the Signal executable is not used for this directory-fixture replay. These fuse observations do not establish whether application code enables another inspection mechanism.

## Reproduce

For the installed system Flatpak core used here:

```bash
PATH=/usr/bin:/bin:$PATH /usr/bin/python3 tools/verify-electron.py \
  --runtime /var/lib/flatpak/app/md.obsidian.Obsidian/current/active/files/obsidian
```

The selected ELF must permit directory application loading and have compatible host libraries. A launch wrapper is rejected. The harness creates a private home, settings, runtime directory, compositor, bus activation environment, registrar and profile, then closes its owned processes. It runs outside Flatpak and does not install the built extension in the regular desktop.

Local artifacts, excluded from Git:

- `reports/electron-export/verification.json`: both cases, runtime/source hashes, assertions and limitations.
- `reports/electron-export/x11/integration.json`: exact source descriptors, final per-window effects and checkbox state comparison.
- `reports/electron-export/x11/integration.json.raw-layout.txt`: raw server-advertised layout after the checkbox operation.
- `reports/electron-export/{x11,wayland}/result.json`: native handles, Meta observations and registrar records.
- `reports/electron-rea.json` and `reports/electron-rea-complete.json`: fuse observations and controlled process Evidence.
- `reports/electron-association-rea-final.json`: controlled replay including the standard GTK property association probe.
- `reports/electron-bridge-rea.json`: controlled replay including the full exported-model bridge.
- `reports/electron-export/x11/electron-panel.png`: the private panel with the imported dynamic command.
- `reports/electron-panel-stable-rea.json`: controlled replay of the production renderer with nested and dynamic native menus.

## REA evidence and limits

Private panel replay Evidence: `ev_350a7fcade60a3a6453517c9a49c6c12a25094f43cdaa1495a56b27e5c71cce5`, exit code 0, seventeen check groups and clean critical-error counts in both Shell logs. See [the panel guide](electron-panel.md) for the precise UI/input scope and remaining limits.

Full-model bridge replay Evidence: `ev_b389a558659e6464b10129edfa258737f5835cd3a2803a500407d999eb9e0e07`, exit code 0, thirteen check groups. The unchanged fixture supplies exact handles. The same sampling and coverage limits below apply.

GTK association replay Evidence: `ev_4e22126a69ac6543511951b34208272c172fece08f7443b71f1242f2a6b041e2`, exit code 0, eleven check groups. The same sampling, environment and observation limits below apply. The fixture's native handles supply the experiment's X11 identities; production third-party identity validation remains unproven.

Obsidian fuse Evidence: `ev_0a47770563f3fb47c75f7b0e2ae25d25653f9587be50deb3342604246b18ee45`. Signal fuse Evidence: `ev_a2a7dab8c0c58cfee7e1599db3b4ba2cd48ca725e83310d7f1ce7b2f6a1f3d0e`. Controlled replay Evidence: `ev_ce378581bc20f6a32ef059312df721362473ff15f0f718eb82a14cb98e3e8042`, exit code 0.

REA verified cleanup of the owned process group and temporary capture root. Some sampled sandbox processes could not be ownership-inspected because `/proc/.../environ` was unreadable. Process sampling can miss short-lived descendants. Filesystem observations are selected before/after snapshots, and recorded executable hashes do not establish an atomic OS image binding. Inherited environment variables may affect the replay. These limits remain part of the Evidence rather than a claim of complete process or filesystem coverage.
