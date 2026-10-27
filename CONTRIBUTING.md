# Contributing to GnoMenu

GnoMenu is an early community project targeting GNOME Shell 50. Start with the compatibility matrix and roadmap before adding an adapter.

## Development setup

Install the dependencies listed in the README, then:

```bash
npm ci --ignore-scripts
python3 tools/verify.py
```

Useful focused checks:

```bash
npm run lint
dbus-run-session -- python3 tests/run-integration.py
dbus-run-session -- python3 tests/run-i18n.py
python3 tests/run-shell.py
python3 tests/run-shell.py --real-apps
```

The Shell tests run private compositors. Their configuration, session bus and application settings are isolated; system services and the user's runtime directory are still shared. Do not run an experimental registrar on your main session bus while the panel cannot consume its registrations.

## Implementation rules

- Create Shell objects, signals and main-loop sources from `enable()`; remove them from `disable()`.
- Keep GTK/Gdk/Adw imports out of the Shell process.
- Use asynchronous D-Bus operations in runtime code.
- Pin unique owners and exact window/action paths. Invalidate old sources immediately when the target changes.
- Preserve exported labels and action parameters. Translate only GnoMenu-owned text.
- Present action-based adapters as partial support. Do not advertise a complete native menu without evidence.
- Do not match windows by application title or PID.
- Keep research and test dependencies outside the installed ZIP.
- Avoid telemetry, clipboard access, remote downloads or process execution in the runtime extension.

## Validation and evidence

A new adapter needs an application version, package source, display backend and a test of the actual command effect. Multiple-window checks must demonstrate that a command does not reach the other window.

Existing real-app tests observe Nautilus through a private AT-SPI bus and verify Ptyxis state through its exported actions. They use empty temporary folders and terminal commands that only sleep.

Fixture Shell tests also inject virtual keyboard and pointer events into the private compositor. They verify opening a menu with Down, moving with Up/Down, activating a checkbox with Return, dismissing with Escape and clicking a menu command. They check checkbox/radio accessibility roles and changes to the checked state. Repeated disable/enable checks verify that panel registrations are removed and restored without duplication. These checks do not replace physical-input or screen-reader testing.

GitHub Actions runs lint, protocol, translation and package checks in a clean Fedora container. Full compositor and real-application checks are a separate local requirement; the workflow does not claim to exercise a graphical desktop.

## Review

Keep changes readable and explain why each action and API is used. AI-assisted contributions require the same maintainer understanding, testing and review as other contributions. Do not submit code that the maintainer cannot explain.

Use English for repository documentation, issues and pull requests. Add translations through the gettext workflow in `po/README.md`.

All new project code uses GPL-3.0-or-later. Preserve attribution and license terms for any future third-party material.
