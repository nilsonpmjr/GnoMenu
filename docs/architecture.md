# Architecture and lifecycle

## Shipped runtime

```text
Focused Mutter window
  → GTK unique bus name + application/window/menu paths
  → GMenuSource
  → application menu + exported menu tree or partial action adapter
  → native GNOME panel buttons and popups
```

The shipped runtime consists of `extension.js`, `windowSource.js`, `gmenuSource.js`, `actionMenus.js`, metadata and CSS. Compiled gettext catalogs and the GPL license text are packaged alongside them.

There is no Python helper, application launcher, network client, telemetry or clipboard integration in the installed ZIP.

## Discovery and transport

`windowSource.js` reads metadata attached to the exact Mutter window. It accepts a unique bus owner and exported action paths even when no menu model is available.

`gmenuSource.js` imports remote models and groups through Gio. Application and window actions use separate paths. Menu traversal is bounded to 512 entries and 12 levels.

Native application menus retain their labels. Conventional application actions provide translated fallback labels when no equivalent native action is present. `actionMenus.js` supplies explicit Nautilus/Ptyxis mappings; commands with missing or incompatible parameters are excluded.

## Lifetimes

Every focused-window change advances an epoch and disposes the old source before the next render. Popup focus temporarily held by the Shell keeps the current target; a different application window changes it.

The source watches its unique D-Bus owner, tracks model/action signals and coalesces updates into an idle source. Destruction disconnects those signals, removes pending work, unwatches the name and clears its state.

Visible nodes carry source provenance. A state refresh may preserve an unchanged command, while changed action identities, foreign-source nodes and disposed sources are rejected.

`disable()` disconnects display/window signals, destroys the current source and panel actors, cancels remaining idles and clears cached model/render state. Runtime objects are created after `enable()`.

## Rendering

PanelMenu and PopupMenu provide GNOME interaction and accessibility primitives. The popup source anchor uses the leading edge, mirrors for RTL and retains the Shell's monitor containment.

State-only updates refresh the existing actors. Structural changes rebuild the menu while preserving an open menu only for the same source.

Checkbox and radio commands expose their respective ATK menu-item roles. PopupMenu ornaments synchronize the checked accessibility state with the exported action state. These semantics are tested in the private compositor; interaction with a running screen reader still needs manual verification.

## Localization

The Extension base class initializes the `gnomenu` gettext domain from metadata. Gio-only modules receive a translator function so they remain testable outside the Shell. Exported application labels are never passed through GnoMenu's translator.

## Staged DBusMenu work

The DBusMenu source, registrar and declared-ID resolver have private-bus integration tests. They remain outside the distribution ZIP and the production panel until actual Mutter-window association is proven.

See the separate window-association document for that boundary.
