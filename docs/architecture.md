# Architecture and lifecycle

## Shipped runtime

```text
Focused Mutter window
  → GTK unique bus name + application/window/menu paths
  → GMenuSource
  → application menu + exported menu tree or partial action adapter
  → native GNOME panel buttons and popups
```

The shipped runtime consists of `extension.js`, `windowSource.js`, `gmenuSource.js`, `actionMenus.js`, `filesDesktopSource.js`, metadata and CSS. Compiled gettext catalogs and the GPL license text are packaged alongside them.

There is no Python helper, network client, telemetry or clipboard integration in the installed ZIP. Desktop launchers use the Shell and Gio application APIs.

## Discovery and transport

`windowSource.js` reads metadata attached to the exact Mutter window. It accepts a unique bus owner and exported action paths even when no menu model is available.

`gmenuSource.js` imports remote models and groups through Gio. Application and window actions use separate paths. Menu traversal is bounded to 512 entries and 12 levels.

Native menu models retain their labels, order, sections, nesting and typed targets. Conventional application actions provide translated fallback labels when no equivalent native action is present. `actionMenus.js` supplies explicit partial Nautilus/Ptyxis mappings. Other action identifiers do not become menu items: an action group does not encode menu placement or user-facing captions.

The owned Nautilus exporter marks its toolbar/context wrappers with `x-gnomenu-layout=files`. For those wrappers, `organizeFilesMenus()` uses app-name/File/Edit/View/Go/Help as the base presentation. It splits original sections by explicit category, retains nested menu labels and targets, puts settings/about/quit under the app name, and merges supported fallback commands without duplicate canonical actions/typed targets. Context-scoped native actions win over their general counterparts, and their source context remains attached to the displayed nodes. Additional unmarked native menubar menus retain their own labels and hierarchy before Help; native headings matching a base category join that category. Empty or fully deduplicated additions are omitted. Model changes remove obsolete menus and commands. Other applications are not regrouped. The final tree is bounded after presentation as well as during import.

## Lifetimes

The extension maintains up to two window sources: the focused window and the last active Files window. Window sources that are no longer either target are disposed. A persistent `FilesDesktopSource` supplies the same explicit Files adapter when no Files window exists. It watches the published application name without requesting service activation and creates a pinned application-only GMenu source when that name has an owner. Its owner epoch invalidates stale commands across disconnects; launchers remain available without an owner. Window actions are never dispatched from this source.

Changing the displayed source or window advances an epoch; popup focus temporarily held by the Shell keeps the current target. Focus identity is tracked independently of source availability, so an empty focused source keeps its application's name while waiting for commands. Files is displayed only when there is no focused app.

The source watches its unique D-Bus owner, tracks model/action signals and coalesces updates into an idle source. Destruction disconnects those signals, removes pending work, unwatches the name and clears its state.

Visible nodes carry source provenance. A state refresh may preserve an unchanged command, while changed action identities, foreign-source nodes and disposed sources are rejected.

`disable()` disconnects display, application and window signals, destroys the window sources, persistent desktop source and panel actors, cancels remaining idles and clears cached model/render state. Runtime objects are created after `enable()`.

Only the displayed source is captured. A captured complete native menubar can use an exported window visibility action to hide its local counterpart. Ownership records the original boolean value and restores it when capture ends; destruction restores it before releasing the action group. Partial and truncated models do not hide local menus.

## Rendering

PanelMenu and PopupMenu provide GNOME interaction and accessibility primitives. The popup source anchor uses the leading edge, mirrors for RTL and retains the Shell's monitor containment.

State-only updates refresh the existing actors. Structural changes rebuild the menu while preserving an open menu only for the same source.

Checkbox and radio commands expose their respective ATK menu-item roles. PopupMenu ornaments synchronize the checked accessibility state with the exported action state. These semantics are tested in the private compositor; interaction with a running screen reader still needs manual verification.

## Localization

The Extension base class initializes the `gnomenu` gettext domain from metadata. Gio-only modules receive a translator function so they remain testable outside the Shell. Exported application labels are never passed through GnoMenu's translator.

## Native exporter experiment

The separate optional native exporter is documented in [the prototype guide](native-exporter.md). It operates inside test Nautilus processes, publishes real native models through standard GTK metadata and forwards widget actions through the exact window action map. The Shell runtime does not load its library. It is outside the installable ZIP and has a separate validation command.

Toolbar, tab, breadcrumb and file-context wrappers carry the Files layout marker at creation; publishing a shared root does not mark every child indiscriminately. Real Back/Forward history popups stay unmarked and retain their native headings. Their aliases pin a popup generation, native model, active slot and location. Notifications permanently invalidate snapshots after slot/location changes, and dispatch checks the context again before resolving the widget group.

## Staged DBusMenu work

The DBusMenu source, registrar and declared-ID resolver have private-bus integration tests. They remain outside the distribution ZIP and the production panel until actual Mutter-window association is proven.

See the separate window-association document for that boundary.
