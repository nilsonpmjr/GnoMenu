# Associação entre janela e menu — estado da investigação

## Fluxo já validado

`RegisterWindow(ID, caminho)` → registrador fixa o proprietário da conexão →
`AppMenuDiscovery.setWindowId(ID)` → consulta assíncrona ao proprietário atual
do registrador → descritor com proprietário único do exportador → DBusMenu.

A bancada executa esse fluxo com duas declarações de janela do mesmo processo
exportador. Comandos chegam somente ao menu selecionado. Trocas rápidas de alvo
cancelam consultas anteriores; remoção de cadastro, perda do registrador e
encerramento do consumidor invalidam a fonte. ID desconhecido, ausente ou zero
não seleciona outro menu.

O módulo `extension/appmenuDiscovery.js` não consulta PID/título para adivinhar
uma fonte. Não inicia serviços e não toma o nome de outro registrador. Os testes
usam barramento privado e IDs declarados pela bancada; isso ainda não comprova
a ligação com janelas reais do Mutter.

## Fronteira pendente no GNOME 50.6

Na introspecção local, `Meta.Window` oferece os caminhos GTK utilizados pelo
adaptador GMenu, além de tipo de cliente, ID interno e descrição. Não encontramos
`get_xwindow` no protótipo público consultado.

O [código do Mutter 50.6](https://github.com/GNOME/mutter/blob/50.6/src/core/window.c)
atribui `window->id` com o gerador de IDs do display; `get_id()` devolve esse
campo. A descrição é construída de forma diferente para XWayland e Wayland.
Isso não autoriza tratar o ID interno como XID, nem transformar o formato textual
da descrição em um contrato estável de produção.

Decisão atual: não ligar automaticamente esse resolvedor ao foco do Shell até
validar uma identidade correta para cada backend. O suporte nativo Wayland
precisará de metadados cooperativos/protocolo apropriado; o suporte XWayland
precisa obter e validar seu identificador de janela. A implementação não força
aplicativos Wayland a usar XWayland.

Próxima bancada: janelas XWayland reais, com títulos iguais e mesmo PID, para
provar a identidade sem depender do nome do aplicativo. Em paralelo, investigar
metadados publicados pelos exportadores reais de Signal/Obsidian.
