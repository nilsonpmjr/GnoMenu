# Electron and Flatpak compatibility investigation

Observed on October 27, 2026, on the development machine. These are interoperability findings, not supported-app claims. No Signal conversations, Obsidian vaults or user browser profiles were read. Vendor application code was analyzed statically. The subsequent [controlled replay](electron-replay.md) stages only an Electron core and runs our own fixture with a temporary profile.

## Installed artifacts

| Application | Installed artifact | Static observation | Next unresolved step |
| --- | --- | --- | --- |
| Signal Desktop 8.32.0, Flatpak | `resources/app.asar`, `bundles/main.js` | Builds an Electron application menu from a template and calls `Menu.setApplicationMenu`. Separate code builds a tray context menu. Renderer IPC also controls local menu visibility. | Observe actual menubar registration in an isolated profile, distinguish it from the tray, and establish an exact window identity. Do not invoke internal IPC to hide a menu without proven capture/ownership. |
| Obsidian 1.14.5, Flatpak | Loader `app.asar` plus bundled `obsidian.asar`, `main.js` | Constructs Electron menu templates; the menu update handler uses per-window `setMenu` on the non-macOS branch. BrowserWindow options include auto-hide behavior. | Validate export on the installed Electron/backend, resolve sandbox access, and retain each window's independent menu/context. The loader can choose a user-downloaded ASAR; that profile-dependent artifact was not inspected. |
| Firefox, Flatpak | Deployment `7985364b35b83cfe5aa17a00932df1c2d1dae69e5c592aa637a53ff1d53fdabc` | No Firefox code was analyzed in this step. | Investigate its own menu implementation/export path; do not infer Electron behavior. |

Signal's analyzed ASAR SHA-256 is `68c5bbb6c7726b19dd8525fbc6428c2c178c9ea8bb0d539eef5c00a227b89e17`. Obsidian's loader ASAR SHA-256 is `bc9de7b91c478a0e30fb4e312f041ac441e9cabccd026713117353f065877dfb`; its bundled application ASAR is `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780`.

REA analyzed only the selected manifests/main modules as inert text. Parent Evidence: Signal `ev_3d19199b07e0453b65488b0e11359f5bb616c485ef8a5d32af5091b8f354b2f9`; Obsidian loader `ev_4185503b8e3411d2e4e641e27fc9e778727e05893798bc58be31af029e315598`; bundled Obsidian app `ev_4d8af6c32347d9a3b010ee6e099036c1699dbce5a6bdc00cd71415a57e44d563`.

Coverage is partial: dependencies and other modules were not analyzed, alias expansion was bounded, and static call sites do not establish execution or D-Bus export. The selected archives also declared integrity hashes contradicting some unpacked native companions (`fs-xattr` for Signal; `btime`/`get-fonts` for the Obsidian loader). Analysis explicitly recorded those contradictions and continued with observed bytes marked untrusted. No cause is established, and those companions were not executed. Local summary Evidence is retained in `reports/electron-artifacts-rea.json`; extracted vendor code stays in ignored build files and is not shipped or committed.

## Transport observations

The local session had no `com.canonical.AppMenu.Registrar` owner. Signal's reported Flatpak policy declares `talk` access to that name. Obsidian's reported policy does not declare it, and the inspected app-specific overrides did not add it. This identifies a sandbox issue to investigate; it does not prove that adding one permission would complete integration. No permissions were changed.

The read-only process query saw Firefox running, while Signal and Obsidian had no running Flatpak instance. An instance-specific endpoint in the Firefox namespace was owned. Introspection of that pinned owner visited five nodes without errors or truncation and found no `org.gtk.Menus`, `org.gtk.Actions` or `com.canonical.dbusmenu` interface within that scope. Namespace matching does not independently prove process or window ownership. This is not proof that Firefox has no internal menus or that no other transport exists.

The earlier probe could label an unowned exact D-Bus name as “not-running.” That conclusion was incorrect: Firefox can be running under an instance-specific name. The updated probe separates process presence, name ownership, exported interfaces and permission declarations. Namespace endpoint identifiers are hashed in reports because names can encode profile paths. It does not associate those endpoints with Mutter windows.

## Reproduce the read-only diagnostic

```bash
PATH=/usr/bin:/bin:$PATH /usr/bin/python3 tools/probe-session.py \
  --flatpak org.signal.Signal \
  --flatpak md.obsidian.Obsidian \
  --flatpak org.mozilla.firefox > reports/application-capabilities.json
```

Inspect an explicit exporter or namespace with repeatable `--name`, for example `--name 'org.gnome.Nautilus.*'`. The probe pins unique owners, uses no service activation, invokes no application actions and starts no registrar. Reports omit environment values and filesystem grants. Permission layers remain separate; the tool does not claim an effective-policy calculation or alter a sandbox. Scan errors and bounds remain visible rather than becoming false absence claims.

The D-Bus probe can also run without the GNOME Shell executable installed. Missing optional desktop tools produce a null version and an explicit query error, while interface inspection continues. The protocol integration suite checks this with those tools removed from its search path.

The controlled replay now observes actual Electron registrations and exact native handles on XWayland. The [experimental bridge](menu-bridge.md) imports every exported fixture menu entry through actual Meta window metadata, routes commands independently and relays dynamic replacement. It records absent registrations in a bounded native Wayland case and a checkbox synchronization gap. Next steps are panel submenu preparation/replacement, third-party identity/lifecycle validation and private panel tests, followed by isolated vendor-application/Flatpak checks. Existing user applications should remain untouched. Static menu construction plus a permission grant remains insufficient to enable panel integration or hide a local menu.
