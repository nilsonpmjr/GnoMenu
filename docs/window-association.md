# Window association research

## Validated protocol pipeline

`RegisterWindow(ID, path)` → registrar pins the calling connection → declared-ID lookup → unique exporter descriptor → DBusMenu source.

Private-bus tests use two menu declarations from the same exporter. They verify action routing, rapid target changes, unregistration, registrar loss and disposal. Unknown, missing and zero IDs do not select an unrelated menu.

`extension/appmenuDiscovery.js` consumes an explicitly supplied X11 window ID. It does not infer a Wayland surface from an application name, PID or tray menu. It does not start services or replace another registrar.

## Boundary in GNOME 50.6

The local `Meta.Window` interface exposes GTK paths used by the GMenu integration, client type, an internal ID and a description. The inspected public prototype did not expose `get_xwindow`.

In [Mutter 50.6 source](https://github.com/GNOME/mutter/blob/50.6/src/core/window.c), the internal window ID is assigned by the display's ID generator. Descriptions are formatted differently for XWayland and Wayland windows. Neither fact establishes that an internal ID is an XID or that the description is a stable production parsing contract.

The declared-ID resolver therefore remains outside the installed panel integration until the actual window identity is validated for each backend.

## Next experiment

Use real XWayland windows with identical titles and the same PID to prove identity independently of application naming. Investigate metadata published by the actual Signal and Obsidian exporters in parallel.

The [installed Electron/Flatpak investigation](electron-compatibility.md) confirms static Electron menu construction and records sandbox declarations. The read-only probe can find instance-specific owned names, but those names still do not establish a Mutter window association. No new DBusMenu panel integration is claimed by that diagnostic.

Native Wayland support needs appropriate cooperative metadata or a suitable protocol. GnoMenu does not force applications to switch display backends.
