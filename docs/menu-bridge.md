# Experimental menu bridge

`companion/dbusmenuBridge.js` converts a pinned DBusMenu source into an exported GMenu model and window action group. It runs in a separate GJS process in the test harness. It is not installed, started or included in the GNOME extension ZIP.

The bridge preserves the imported model's labels, heading order, nested menus and visible commands. It adds no application-specific headings or command lists. Native separators become GMenu sections. Commands forward to the exact source item; disabled items and descendants of disabled menus remain non-actionable. Native checkbox and radio values become stateful actions, with state determined by the exporter rather than optimistic local toggling.

Every native snapshot receives new action names. An action queued for an earlier snapshot cannot address a reused remote item ID. Native owner loss clears the model and actions. Disposal unexports both interfaces and destroys the native adapter. A truncated model is withheld instead of being published as a complete capture.

## Lazy menus

Submenus export the standard GMenu `submenu-action` attribute and a boolean action. Requesting `true` calls the native adapter's `AboutToShow`/opened sequence; requesting `false` sends closed. Native layout replacement publishes a new action generation. A consumer must use the current submenu action when reopening after replacement, rather than retaining an obsolete action name. Duplicate in-flight preparations on the same action are suppressed.

The tests exercise these actions using a GMenu/D-Bus consumer. The production panel does **not yet prepare these actions**. A successful model replay is not a panel UI test. Retaining open menus through asynchronous replacement and forwarding nested opening/closing in the Shell renderer are the next integration steps.

## Evidence

Nine independent protocol check groups run in the normal integration suite, including CI. They cover model structure and availability, exact command routing, live toggle notifications, lazy menu events, disabled ancestors, unsupported indeterminate toggles, stale commands, size limits, disposal and native owner loss.

The [controlled Electron replay](electron-replay.md) now bridges every exported entry of its two actual XWayland fixture windows, comparing the imported hierarchy with the original DBusMenu snapshots. The unchanged production `sourceForWindow` and `GMenuSource` import through actual Meta window metadata. Native command invocation and dynamic replacement cross both protocols independently per window. Only the harness writes temporary GTK properties, using native handles supplied by its own fixture.

The replay uses Electron 43.8.3 outside Flatpak with our application code. Signal and Obsidian application code and user profiles are not run. There is no production X11 client discovery or registrar startup. Native Wayland remains a separate unsupported association/export path in this experiment.

## Limits before production

- Integrate submenu preparation, focus transitions, replacement and disposal with the actual panel renderer, including nested menus.
- Validate third-party X11 identities and window lifetimes independently of fixture-provided handles; preserve pre-existing application metadata and competing registrars.
- Define explicit companion installation, launch, recovery and removal. Keep local menus available until ownership can be established and restored.
- Preserve additional presentation data such as native shortcut labels and icons; the current DBusMenu adapter does not import those properties.
- Handle indeterminate toggle presentation. The bridge carries an `x-gnomenu-indeterminate` marker and disables those items; the current panel does not render the mixed state.
- Investigate exporter state fidelity separately. The Electron checkbox callback changes its value while `GetLayout` still advertises unchecked. The bridge does not conceal that mismatch.
- Test actual vendor applications and Flatpak boundaries. Model conversion alone does not establish their support.
