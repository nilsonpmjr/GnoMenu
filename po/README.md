# Translations

GnoMenu inherits the session locale through the `gnomenu` gettext domain. It does not modify LANG, LC_MESSAGES, LC_ALL or LANGUAGE in the Shell process and has no separate language selector.

Initial catalogs: `pt_BR`, `pt` (European Portuguese), `es`, `fr`, `de`, `it`. English message identifiers provide the fallback. Regional variants use gettext's normal language fallback, such as `es_MX → es`.

Translate only text owned by GnoMenu. Names, headings, shortcuts and labels exported by applications must remain unchanged. Fixtures deliberately include native labels that match translation keys to catch accidental retranslation.

## Update or add a catalog

```bash
python3 tools/build-translations.py --update-template
msgmerge --update --no-wrap po/pt_BR.po po/gnomenu.pot
msginit --input=po/gnomenu.pot --locale=nl --output-file=po/nl.po
```

Review translations and remove fuzzy markers only after checking them. Compile with:

```bash
python3 tools/build-translations.py
```

Compiled files are generated in `extension/locale/<language>/LC_MESSAGES/gnomenu.mo`. Edit the PO/POT sources rather than generated MO files. The packager includes compiled catalogs and verifies their bytes.

## Test

```bash
dbus-run-session -- python3 tests/run-i18n.py
python3 tests/run-shell.py --locale pt_BR.UTF-8
python3 tools/dev-session.py --locale pt_BR.UTF-8
```

The locale option belongs only to the development harness. The installed extension inherits the real session locale.

Project translations use GPL-3.0-or-later.
