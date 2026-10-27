# GnoMenu roadmap

The long-term goal is broad global-menu support across system applications and compatible Flatpaks. The first public version will describe its actual coverage rather than promise universal menu extraction.

## Implemented

- Application name first, followed by application menus.
- Public display name: GnoMenu Global Menu; short brand: GnoMenu.
- Public GitHub repository, permanent UUID and passing GitHub Actions checks.
- Native exported GMenu models, sections, nested menus and live action state.
- Standard exported preferences/about/quit actions as a fallback.
- Partial action menus for Nautilus 50.4 and Ptyxis 50.1.
- Generic native imports preserve menu order, hierarchy, labels and targets; unplaced action identifiers do not create new menus.
- Nautilus uses app-name/File/Edit/View/Go/Help as base categories. Captured toolbar/context commands join the matching categories, with native labels, typed targets and context guards; additional native menubar menus retain their own headings and follow context changes. Repeated actions prefer their captured context over the general fallback.
- Every focused app retains its name, including apps without captured commands; Files is the desktop fallback.
- Files categories remain on the desktop after the last window closes; launchers work and window-dependent actions are disabled.
- Reversible local-menubar ownership through exported window visibility actions.
- Exact window-scoped commands, source disposal and stale-response handling.
- Leading-edge dropdown placement, RTL behavior and monitor-edge containment.
- Session-language inheritance with six gettext catalogs and English fallback.
- Real Nautilus/Ptyxis checks using two windows per application.
- Basic keyboard and pointer event tests in the private compositor.
- Checkbox/radio accessibility roles and checked-state synchronization.
- Repeated disable/enable checks for source and panel-registration cleanup.
- DBusMenu transport, registrar and declared-ID discovery in private-bus tests.
- Runtime-only deterministic ZIP builds, lint and release-package auditing.

## First public alpha

- Maintainer review of the shipped code and its lifecycle.
- Complete the manual keyboard, pointer, accessibility and coexisting-panel checks in the publishing guide.
- Confirm the release ZIP in a clean GNOME 50 login.
- Submit for GNOME Extensions review and address reviewer feedback.

These steps prepare a community extension for the catalog. GNOME approval is a separate external review.

## Compatibility work

- Working optional prototype: actual Nautilus Main Menu/View Options/Current Folder Menu, widget-action forwarding, local control hiding/restoration and two-window checks in two locales. Native folder creation and bookmark operations are verified against the private filesystem. See `docs/native-exporter.md`; the default installation remains the partial adapter.
- Native exporter follow-up: keep bindings current across tab lifetimes and view changes, deduplicate responsive header/bottom-bar menus and restore controls when capture becomes incomplete.
- Native tab context menus use the actual page title and preserve the clicked page across popup dismissal. Real-app checks cover movement, inactive-tab close and retired command aliases; detach, restore and close-other-tabs still need validation.
- Native breadcrumb menus are captured after a real right-click using the original model and folder tooltip. Real-app checks cover opening the clicked parent in a background tab and retiring aliases when another ancestor replaces its context; Properties and New Window still need validation.
- Native file-selection and background menus are captured after native popup requests. Selection snapshots preserve actual file objects, retire when selection/location/loading changes and ignore redundant notifications. Real-app checks cover Select All, opening one/two selected folders and stale-command retirement; trash/deletion and broad file-type coverage remain pending.
- Native Copy/Paste and Cut/Paste are verified between two private Files windows with exact marker contents. Single-folder Rename is verified through the actual native entry; display-name changes retire the old context even when the selected object stays the same. Trash/deletion, batch rename and broader file types remain pending.
- Export original local menu models and their widget actions from applications that currently keep them private, starting with Nautilus/Ptyxis.
- Prove the association between DBusMenu registrations and actual Mutter windows.
- Investigate Signal and Obsidian exporters and Flatpak bus policies.
- Investigate the installed Firefox build separately.
- Extend Nautilus/Ptyxis coverage to commands not currently exported.
- Test additional application versions and package formats.
- Add more languages and review translations with native speakers.

## Interaction and recovery

- Full keyboard and screen-reader validation.
- Icons and shortcut presentation where reliable metadata exists.
- Long titles, overflow, HiDPI, RTL and multiple monitors.
- A user-facing capability report.
- Local-menu ownership for additional toolkits and applications without exported visibility controls.

## Longer term

- Additional GNOME versions, each with explicit validation.
- Cooperative exporter improvements in applications and toolkits.
- Upstream GNOME proposals where the necessary interfaces are missing.
