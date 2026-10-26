# Traduções do GnoMenu

O GnoMenu herda a língua da sessão por gettext, domínio `gnomenu`. Não altera
`LANG`, `LC_MESSAGES`, `LC_ALL` ou `LANGUAGE` no processo do Shell. Não há
seletor de idioma na extensão. Uma sessão iniciada com outra língua recebe
automaticamente a tradução disponível; se não houver catálogo, usa inglês.

Catálogos iniciais: `pt_BR`, `pt` (português europeu), `es`, `fr`, `de`, `it`.
Inglês é a língua dos identificadores de mensagem e não precisa de um `.po`.
Variantes regionais seguem o fallback do gettext, como `es_MX → es`.

Traduzimos exclusivamente textos produzidos pelo GnoMenu. Nomes, rótulos,
atalhos, ações e títulos exportados pelos aplicativos permanecem como enviados.
As aplicações de bancada exportam alguns textos em português de propósito;
isso permite verificar que não são retraduzidos pela extensão.

Para atualizar o template:

```bash
python3 tools/build-translations.py --update-template
```

Para atualizar um catálogo existente ou iniciar outro:

```bash
msgmerge --update --no-wrap po/pt_BR.po po/gnomenu.pot
msginit --input=po/gnomenu.pot --locale=nl --output-file=po/nl.po
```

Revise as traduções e remova a marca `fuzzy` somente após confirmar o texto.
`python3 tools/build-translations.py` valida e compila os arquivos em
`extension/locale/<língua>/LC_MESSAGES/gnomenu.mo`. Essa pasta é gerada; os `.po`
e o `.pot` são os arquivos de edição. O empacotador inclui os `.mo` no ZIP e
confere se correspondem exatamente aos catálogos compilados.

Testes de seleção real de língua e preservação de menus nativos:

```bash
dbus-run-session -- python3 tests/run-i18n.py
python3 tests/run-shell.py --locale pt_BR.UTF-8
```

Para experimentar em outro idioma sem alterar o desktop:

```bash
python3 tools/dev-session.py --locale pt_BR.UTF-8
```

`--locale` é apenas uma opção do lançador da bancada. Sem ela, a demonstração
também herda o ambiente de quem a iniciou.
