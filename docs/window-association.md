# Window association research

## Validated protocol pipeline

`RegisterWindow(ID, path)` → registrar pins the calling connection → declared-ID lookup → unique exporter descriptor → DBusMenu source.

Private-bus tests use two menu declarations from the same exporter. They verify action routing, rapid target changes, unregistration, registrar loss and disposal. Unknown, missing and zero IDs do not select an unrelated menu.

`extension/appmenuDiscovery.js` consumes an explicitly supplied X11 window ID. It does not infer a Wayland surface from an application name, PID or tray menu. It does not start services or replace another registrar.

## Boundary in GNOME 50.6

The local `Meta.Window` interface exposes GTK paths used by the GMenu integration, client type, an internal ID and a description. The inspected public prototype did not expose `get_xwindow`.

In [Mutter 50.6 source](https://github.com/GNOME/mutter/blob/50.6/src/core/window.c), the internal window ID is assigned by the display's ID generator. Descriptions are formatted differently for XWayland and Wayland windows. Neither fact establishes that an internal ID is an XID or that the description is a stable production parsing contract.

The declared-ID resolver therefore remains outside the installed panel integration until the actual window identity is validated for each backend.

## Standard GTK property association probe

The controlled XWayland replay now publishes temporary `_GTK_UNIQUE_BUS_NAME`, `_GTK_MENUBAR_OBJECT_PATH` and `_GTK_WINDOW_OBJECT_PATH` properties on its two owned native window handles. Each window receives a separate exported GMenu model and action group under the probe's unique D-Bus owner. Existing GTK properties cause the experiment to refuse replacement.

The private Shell observer calls the **unchanged production `sourceForWindow`** on actual Meta windows. The test uses those returned descriptors with the **unchanged `GMenuSource`** to import and activate one command per window. The action forwards to that window's actual Electron DBusMenu increment command. Both per-window counters change independently despite identical titles and a shared PID. No Meta description or internal ID is parsed for association.

Afterward, the probe disposes its sources, rejects stale commands, removes its own exports and properties, and waits for Mutter to clear the association. Cleanup preserves property values replaced by another writer. These checks run only on the private desktop.

This establishes a potential companion-to-Mutter association seam for X11. The probe is **not a full menu bridge**: it exports only a known fixture command and obtains XIDs from the controlled application's native handles. It does not discover or authenticate arbitrary client windows, render the imported menu in the panel, synchronize all model features, take local-menu ownership or provide an installable companion. X11 properties are client metadata, not a security boundary.

## Remaining experiments

The [controlled Electron replay](electron-replay.md) uses two actual XWayland windows with identical titles and the same PID. Their native handles match distinct registrar entries, and the existing discovery/transport pipeline routes real commands independently. Meta internal IDs differ from those XIDs, and the objects do not expose `get_xwindow`. Description strings remain observations only. Next steps are a complete menu bridge, independently validated third-party X11 identity/lifecycle handling, and private panel tests before any production integration.

The [installed Electron/Flatpak investigation](electron-compatibility.md) confirms static Electron menu construction and records sandbox declarations. The read-only probe can find instance-specific owned names, but those names still do not establish a Mutter window association. No new DBusMenu panel integration is claimed by that diagnostic.

Native Wayland support needs appropriate cooperative metadata or a suitable protocol. GnoMenu does not force applications to switch display backends.
