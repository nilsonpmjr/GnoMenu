# Experimental X11 ownership guard

`companion/x11_identity.py` verifies a registrar-declared XID against independent X server and D-Bus observations. It reads only: no menu invocation, property publication or local-menu hiding occurs in the guard. It is outside the extension ZIP and intended for an isolated, single-threaded worker with a supervisor timeout, not the Shell process.

## Checked contract

1. Require a positive uint32 XID and a unique D-Bus connection name. Never select a window by title, PID or a well-known alias.
2. Read the unique connection's Unix process credentials from the session bus without activation.
3. Check that the XID is a live window and belongs to the compositor's bounded `_NET_CLIENT_LIST`.
4. Require XRes 1.2 and obtain the resource-owning client's PID from the X server. `_NET_WM_PID` is not read by the guard.
5. Require agreement with the D-Bus credentials, then check the window, XRes PID and unique owner's credentials again before returning the observation.

Missing libraries, unavailable credentials, missing server PID, unsupported protocol versions or ambiguous/bounded-out observations do not become accepted identities. The Xlib error handler converts invalid-window protocol errors into rejection inside this dedicated worker. A closed worker refuses further checks.

The library ABI was checked against the [upstream libXres 1.2.2 source archive](https://www.x.org/releases/individual/lib/libXres-1.2.2.tar.xz), especially `include/X11/extensions/XRes.h` and `src/XRes.c`. Archive SHA-256: `9a7446f3484b9b7538ac5ee30d2c1ce9e5b7fbbaf1440e02f6cca186a1fa745f`. `XResQueryClientIds` returns `Success` (zero), unlike the boolean success contract of `XResQueryVersion`. Xlib layouts/signatures were also checked against the installed `Xlib.h`. Installed libraries: libXres 1.2.2 and libX11 1.8.13 on the tested Fedora/Bazzite host.

## Bounded replay

The [Electron replay](electron-replay.md) obtains both declarations directly from the private registrar and verifies them before supplying descriptors to the bridge/property publisher. The guard receives no fixture native-handle file, app title or expected PID. The outer harness compares the resulting XIDs with the fixture's native handles only as a test oracle. The existing panel checks then exercise these exact descriptors.

Seven additional check groups cover independent ownership agreement, invalid XIDs/aliases, root/nonexistent windows, foreign/missing owners, a forged `_NET_WM_PID`, unavailable libraries/displays, and closure of one window while its exporter and other window remain alive. The forged hint is changed only on an already verified owned fixture window and restored in `finally`. No vendor application or user window is modified.

Reports are `reports/electron-export/x11/identity.json` and `identity-withdrawal.json`; the aggregate replay now contains **24 groups**, including the previous 17 transport/panel/backend checks. Reproduce with the command in the replay guide. This optional experiment requires local X11/XWayland, libX11 and libXres; the installed extension does not gain those dependencies.

REA identity replay Evidence: `ev_b352596415279441aa76630a5955bdbe113da27d1531d6223e712fc3a8b175f9`, exit code 0, 24 groups, with no GJS, JavaScript, Clutter or St critical errors in either Shell log. The complete inline record is retained locally in `reports/x11-identity-rea-final.json`. REA verified owned-group cleanup and removal of its temporary capture root; some sampled processes could not be ownership-inspected through `/proc`. Process sampling and selected filesystem snapshots do not establish complete process, filesystem or network observation. The earlier panel-only record remains linked in the panel guide.

## Limits before an automatic companion

This is a non-atomic identity snapshot, not an authorization lease or authentication of menu contents. A cooperating process can declare the wrong menu for one of its own windows. Same-user X11 clients can manipulate client properties, and XID reuse/lifetime changes remain possible after the final check. A publisher must revalidate current registrations, resource identity, pre-existing GTK metadata and restoration ownership when writing or removing properties.

The controlled replay proves the guard on our fixture. It does not qualify arbitrary third-party applications. Flatpak D-Bus proxies, PID namespaces, separate-process exporters and X11 server boundaries need their own evidence; a mismatch is rejected rather than guessed around. Native Wayland has no XID path here and is not coerced into one. The companion remains uninstalled, and no registrar starts on the regular desktop.
