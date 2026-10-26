# GnoMenu — fila de produto

Objetivo: menu global para GNOME com a maior cobertura viável entre aplicativos
do sistema e Flatpaks. Os primeiros casos reais são Ptyxis, Nautilus, Signal,
Obsidian e Firefox. Nautilus/Ptyxis já foram validados com suporte parcial em
programas reais; a bancada dos protocolos não comprova os demais aplicativos.

## P0 — identidade e menu do aplicativo

Requisito confirmado pelo usuário: **o nome do aplicativo vem primeiro**, como
no macOS, antes de Arquivo, Editar, Exibir etc. Esse primeiro menu reúne as
configurações e ações próprias do aplicativo.

Critérios de aceitação:

- Nome obtido da identidade do aplicativo, sem confundir com título de documento.
- Primeiro título em destaque: `Nome do app · Arquivo · Editar · Exibir …`.
- Preferir o menu de aplicação exportado, preservando seus rótulos e comandos.
- Quando não existir esse modelo, integrar ações convencionais de aplicação
  realmente exportadas (`preferences`, `settings`, `about`, `quit`) e sem
  parâmetros obrigatórios. Não inventar uma configuração que o app não fornece.
- Menu nativo tem precedência sobre os rótulos de fallback. Não duplicar uma
  ação já presente no menu de aplicação.
- Sem fonte compatível, continuar mostrando a identidade do aplicativo com
  status honesto; nunca conservar comandos do aplicativo anterior.
- Não reorganizar automaticamente o restante do menu exportado por heurísticas
  de tradução, nem confundir as configurações do GnoMenu com as do aplicativo.

Estado: **implementado e validado com GMenu na bancada e no GNOME 50.6 real**.
O transporte importa menus de aplicação dedicados e usa ações exportadas como
fallback. Fontes sem essas ações não recebem comandos inventados.
Reorganização de comandos já
embutidos em Arquivo/Editar, personalização e localização completa ficam para
uma etapa posterior de experiência.

## P0 — segundo transporte: DBusMenu

- Bancada real de `com.canonical.dbusmenu`, sem depender de GTK/GMenu.
- Layout, separadores, itens invisíveis/desabilitados, seleção e atualizações.
- Preparar submenus via `AboutToShow` e enviar eventos com o ID de origem.
- Proprietário D-Bus fixo, timeout, cancelamento e descarte de respostas antigas.
- Associação comprovada da fonte à janela antes de mostrar menus de apps reais.
- Registrar cobertura separada para Wayland nativo e XWayland. Um menu de bandeja
  não é evidência de menu de janela: nunca usar o StatusNotifier como substituto.

Estado: **adaptador, registrador e bancadas implementados**: dez grupos de
verificações do transporte e seis do registrador. O registrador usa a identidade
real da conexão chamadora, recusa substituição de cadastros de outro proprietário,
limpa registros ao desconectar e não toma o nome de outro registrador.
Não integrado à descoberta automática nem ao painel; associação entre fonte
DBusMenu e janela real continua pendente. O serviço só foi iniciado nos testes
isolados, sem instalação, autostart ou ativação na sessão principal.

O resolvedor de registros também foi implementado e validado com seis grupos
de testes de ponta a ponta: registro → consulta por ID declarado → DBusMenu →
execução no menu correto. Ainda depende de uma identidade de janela fornecida
explicitamente; a ligação com o foco do Mutter continua pendente.

## P0 — idioma herdado do sistema

**Implementado:** gettext do GNOME com inglês como fallback e catálogos `pt_BR`,
`pt`, `es`, `fr`, `de` e `it`. Sem seletor próprio e sem modificar o locale do
Shell. Textos exportados pelos aplicativos não são retraduzidos.

Validação: dez cenários de precedência/fallback em processos reais GJS/Gio e
verificação do painel no idioma herdado da sessão e em pt-BR. O ZIP inclui os
catálogos compilados. Novos idiomas podem ser adicionados em `po/`.

## P1 — compatibilidade real

- Signal e Obsidian: verificar exportação e políticas Flatpak nos dois sentidos.
- **Ptyxis 50.1 e Nautilus 50.4: suporte parcial implementado e validado** por
  ações exportadas, sem exigir um GMenu. Os perfis filtram comandos por nome e
  tipo de parâmetro. Nova/fechar aba do Nautilus e somente leitura do Ptyxis
  foram verificados em duas janelas reais de cada app, em dois idiomas.
- Completar os comandos internos de Nautilus/Ptyxis que não são exportados e
  ampliar a validação a versões/pacotes adicionais.
- Firefox: investigação da build instalada, com adaptador separado se necessário.
- Generalizar por protocolo/toolkit, sem lista fechada de aplicativos suportados.

## P1 — experiência e recuperação

- **Alinhamento corrigido:** dropdown ancorado na borda inicial do título,
  acompanhando RTL e a contenção na borda do monitor. Validação geométrica no
  Shell real para os três títulos e capturas em `reports/alignment-*.png`.
- Teclado, hover entre títulos, leitores de tela, novos idiomas, ícones e atalhos.
- Overflow, títulos longos, HiDPI, RTL e múltiplos monitores.
- Ocultar menu original só com mecanismo reversível e restauração validada.
- Relatório de capacidades por app/build/pacote e diagnóstico compreensível.

## P2 — distribuição e integração upstream

- Preferências próprias do GnoMenu e atualizações compatíveis por versão do Shell.
- Empacotamento e documentação para instalação/removal.
- Propostas cooperativas para aplicativos, toolkits e GNOME quando faltarem APIs.
