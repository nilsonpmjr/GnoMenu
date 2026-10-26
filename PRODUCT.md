# GnoMenu roadmap

The long-term goal is broad global-menu support across system applications and compatible Flatpaks. The first public version will describe its actual coverage rather than promise universal menu extraction.

## Implemented

- Application name first, followed by application menus.
- Public display name: GnoMenu Global Menu; short brand: GnoMenu.
- Native exported GMenu models, sections, nested menus and live action state.
- Standard exported preferences/about/quit actions as a fallback.
- Partial action menus for Nautilus 50.4 and Ptyxis 50.1.
- Exact window-scoped commands, source disposal and stale-response handling.
- Leading-edge dropdown placement, RTL behavior and monitor-edge containment.
- Session-language inheritance with six gettext catalogs and English fallback.
- Real Nautilus/Ptyxis checks using two windows per application.
- DBusMenu transport, registrar and declared-ID discovery in private-bus tests.
- Runtime-only deterministic ZIP builds, lint and release-package auditing.

## First public alpha

- Configure the actual public repository URL and permanent controlled UUID namespace.
- Maintainer review of the shipped code and its lifecycle.
- Complete the manual keyboard, pointer, accessibility and coexisting-panel checks in the publishing guide.
- Confirm the release ZIP in a clean GNOME 50 login.
- Submit for GNOME Extensions review and address reviewer feedback.

These steps prepare a community extension for the catalog. GNOME approval is a separate external review.

## Compatibility work

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
- Reversible local-menu hiding only for integrations with proven restoration.

## Longer term

- Additional GNOME versions, each with explicit validation.
- Cooperative exporter improvements in applications and toolkits.
- Upstream GNOME proposals where the necessary interfaces are missing.
