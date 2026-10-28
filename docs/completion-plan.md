# Completion plan

GnoMenu has a working Shell extension and an experimental Files exporter. Completing the first community alpha and completing the broader compatibility goal are separate milestones. The expanded Files integration is not yet a normally installed product.

## First community alpha

| Gate | Current evidence | Remaining acceptance criteria |
| --- | --- | --- |
| Extension core | Exported GMenu imports, partial Files/Ptyxis adapters, localization, lifecycle and private Shell checks | Maintainer code review; clean GNOME 50 login using the exact audited ZIP |
| Input and accessibility | Automated basic keyboard/pointer checks and checkbox/radio roles | Physical input, screen reader, coexisting panel extensions, HiDPI and multiple monitors |
| Packaging | Deterministic runtime ZIP, package audit and GitHub CI | Final release description/screenshots matching the shipped feature set |
| Catalog submission | Public repository and permanent UUID | GNOME Extensions account upload and external review; respond to feedback |

Catalog publication makes this a community extension available through GNOME Extensions. It does not make global menus a native GNOME feature.

## Full product priorities

1. **Compatibility beyond Files.** Demonstrate an actual supported path for Signal and Obsidian, starting with their shipped Electron menu implementations. The experimental [full-model bridge](menu-bridge.md) now passes through actual XWayland Meta window metadata in the controlled fixture. Integrate submenu preparation and replacement with the private panel renderer, then validate third-party identity/lifecycle handling before production use. A tray menu, app name or PID is insufficient evidence of a window menubar. Test native Wayland and XWayland separately; do not silently force a backend change.
2. **Normal Files exporter installation.** Define a separate companion build/package, supported Nautilus/GTK versions, explicit per-app launch, detection of an already-running uninstrumented application, removal and recovery. The current opt-in library runs only in the private harness and stays outside the extension ZIP. The production path must restore local controls when capture ends and avoid global preloading.
3. **Firefox and Flatpak coverage.** Establish the interfaces and sandbox permissions of each actual package/version. Permission declarations and static menu construction do not prove a working global menu. Firefox requires its own investigation; Electron findings do not apply to it.
4. **Release robustness.** Extend accessibility and layout coverage, test more file types and remaining contextual commands, and exercise long-running app/window lifetimes. Record version/backend/package boundaries for each supported application.

The [Electron/Flatpak findings](electron-compatibility.md) identify the next concrete interoperability experiments. The [publishing guide](publishing.md) tracks the submission steps. None of the unverified priority applications should be advertised as supported yet.

## Definition of completion

For each priority application, demonstrate that menus reach the correct window, actions retain their native targets and availability, focus/desktop transitions work, and local-menu ownership restores cleanly. Document the supported package/version/backend and limitations. A normal installation must reproduce that behavior outside the development harness.

The broad goal remains all applications that can supply a usable menu. Applications that expose no usable model need a cooperative exporter or a version-specific adapter; the extension cannot guarantee universal extraction from unrelated processes.
