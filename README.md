# Menu global para GNOME — GnoMenu

Primeiro protótipo funcional para GNOME 50 e Wayland. Importa menus GMenu
exportados por aplicações GTK e mostra seus títulos no painel. Ainda não oferece
suporte completo a todos os aplicativos prioritários. Nautilus 50.4 e Ptyxis
50.1 já têm suporte parcial por ações exportadas, validado com programas reais.
Veja a [matriz de compatibilidade](docs/compatibility.md).

O nome de produto é **GnoMenu**; o UUID é `gnomenu@nilsonpmjr.local`.
A [fila de produto](PRODUCT.md) registra prioridades e critérios de aceitação.

## Experimentar o protótipo

No diretório do projeto:

```bash
python3 tools/dev-session.py
```

Abre um GNOME de desenvolvimento em uma janela, com duas janelas GTK que
exportam menus e uma aplicação sem menu exportado. A extensão só é ativada
nessa sessão, com D-Bus, configurações, dados e cache separados. Ao fechar
a janela do GNOME de desenvolvimento, o lançador encerra os processos de teste.
A sessão continua usando os serviços do sistema e o diretório de runtime do
usuário; não é um contêiner. Não modifica a lista de extensões do desktop atual.

Neste Bazzite, o viewer `mutter-devkit` estava ausente. Preparei uma cópia local
da mesma versão do Mutter (50.6), extraída do RPM oficial Fedora com assinatura
verificada, em `build/deps/devkit/`. Nenhum pacote foi instalado no sistema.
Para reproduzir essa preparação no Fedora/Bazzite ou atualizar após trocar a
versão do Mutter:

```bash
python3 tools/bootstrap-devkit.py
```

O lançador prefere `/usr/libexec/mutter-devkit` quando instalado; caso contrário,
usa a cópia local. Inicia o compositor com `--headless --devkit` e o viewer
separadamente, para não depender do caminho fixo de instalação do executável.
Esse comportamento foi conferido no
[código do Mutter 50.6](https://github.com/GNOME/mutter/blob/50.6/src/core/meta-context-main.c).

Na demonstração, alterne entre as janelas e use **Arquivo → Incrementar esta
janela**, **Exibir → Marcar opção**, os modos de seleção e o comando dinâmico.
O contador visual identifica a janela que recebeu o comando. O aplicativo sem
menu mostra um status de indisponibilidade no painel.
O primeiro título é **GnoMenu Demo**, com as ações de preferências, sobre e sair
exportadas pelo aplicativo. Os rótulos adicionados pelo GnoMenu seguem o idioma
da sessão; os menus exportados pela bancada permanecem como enviados.
Após atualizar o código, feche e reabra a demonstração para carregar a nova
versão da extensão; cada sessão usa uma cópia isolada dos arquivos.

## Idiomas

O GnoMenu herda o idioma da sessão por gettext, sem seletor próprio nem alteração
das variáveis do Shell. Inclui português do Brasil e de Portugal, espanhol,
francês, alemão e italiano, além de inglês como fallback. Variantes regionais
usam o catálogo da língua quando disponível. Nomes e textos exportados pelos
aplicativos seguem o idioma escolhido pelos próprios aplicativos.

Para testar português sem alterar o desktop:

```bash
python3 tools/dev-session.py --locale pt_BR.UTF-8
```

Sem `--locale`, a demonstração também herda o ambiente de quem a iniciou.
Veja [como contribuir com traduções](po/README.md).

## Desenvolvimento e empacotamento

Para instalar no desktop principal, preservando as outras extensões:

```bash
python3 tools/install-local.py
```

Saia e entre novamente no GNOME para carregar uma extensão nova. A demonstração
isolada não altera o menu dos aplicativos que estão no desktop principal.

Também é possível testar os programas reais dentro da sessão de desenvolvimento:

```bash
python3 tools/dev-session.py --real-apps --locale pt_BR.UTF-8
```

Pré-requisitos presentes na máquina de desenvolvimento: GNOME Shell 50 com
`--devkit` e suporte headless/monitor virtual, GJS, Python/PyGObject, GTK4,
Gio, `dbus-run-session`, `gsettings`, gettext (`msgfmt`) e `gnome-extensions`.

Para criar o ZIP instalável, sem instalar nem ativar no desktop:

```bash
python3 tools/package.py
```

Saída: `build/gnomenu@nilsonpmjr.local.shell-extension.zip` e SHA256.
O pacote contém os seis arquivos de runtime e os seis catálogos compilados.
Não é necessário ter ferramentas gettext instaladas para usar o ZIP. O driver
de testes e as aplicações de bancada ficam fora do pacote.

## O que já funciona e foi testado

- Descoberta por metadados da janela do Mutter, com proprietário D-Bus único.
- Importação assíncrona de GMenu, submenus, seções e ações de aplicação/janela.
- Nome do aplicativo primeiro, em destaque, seguido dos títulos do menu exportado.
- Menu de aplicação dedicado quando exportado; configurações/sobre/sair por ações
  convencionais exportadas como fallback, sem inventar parâmetros obrigatórios.
- Títulos no painel, popups do GNOME, seleção booleana e por valor e estado habilitado.
- Dropdowns ancorados na borda inicial do título, com RTL e contenção no monitor.
- Idioma herdado da sessão, seis catálogos e inglês como fallback, preservando menus nativos.
- Ações sem modelo GMenu: descoberta genérica e menus parciais para Nautilus/Ptyxis.
- Comandos ligados à janela de origem, com descarte da fonte ao trocar o foco.
- Atualização de menus dinâmicos, desaparecimento do processo e fechamento de janela.
- Limite de 512 itens/12 níveis e indicação de truncamento para modelos grandes.
- Limpeza ao desabilitar e reativação sem reiniciar o Shell.

O adaptador `extension/dbusmenuSource.js` e seu exportador de bancada já foram
implementados e testados independentemente: propriedades, eventos, submenus
preguiçosos, mudanças durante consultas, timeout/recuperação e descarte.
Ele ainda não é usado pelo painel nem incluído no ZIP: falta comprovar a
associação da fonte DBusMenu à janela real, antes de integrar a descoberta.

O registrador `broker/appmenu-registrar.py` também foi implementado e testado
com conexões D-Bus independentes. Mantém as declarações `(window ID, proprietário
único, caminho)` e limpa registros ao desconectar. Ele **não** inicia com a
extensão nem foi ativado na sessão principal. Receber uma declaração de ID 0
não a transforma na identidade de uma superfície Wayland.
Contrato de referência:
[AppMenu.Registrar no KDE](https://github.com/KDE/plasma-workspace/blob/master/appmenu/com.canonical.AppMenu.Registrar.xml).

O módulo `extension/appmenuDiscovery.js` liga os IDs explicitamente declarados
no registrador às fontes DBusMenu. A bancada valida esse fluxo com dois menus
do mesmo exportador, troca rápida de alvo, remoção de registro e perda do
registrador. Ele ainda não está ligado às janelas do Mutter nem incluído no ZIP.
Consulte a [investigação da associação de janelas](docs/window-association.md).

Não implementado ainda: descoberta de DBusMenu no Mutter, menus completos de
aplicativos sem GMenu exportado, ícones, exibição de atalhos, testes de leitores de tela,
suporte a outros GNOME e ocultação do menu original. Os menus locais da bancada
continuam visíveis. Nenhuma permissão de Flatpak foi alterada.

### Verificação reproduzível

```bash
python3 tools/verify.py
```

Esse comando executa os testes, empacota e atualiza relatório/captura somente
depois que todas as etapas passam. Para rodar as suítes separadamente:

```bash
dbus-run-session -- python3 tests/run-integration.py
dbus-run-session -- python3 tests/run-i18n.py
python3 tests/run-shell.py
python3 tests/run-shell.py --locale pt_BR.UTF-8
python3 tests/run-shell.py --real-apps
python3 tests/run-shell.py --real-apps --locale pt_BR.UTF-8
```

A suíte de transportes executa onze grupos GMenu, dez DBusMenu, seis do registrador
e seis do fluxo de descoberta com
exportadores reais em um barramento privado: fontes independentes, modelos de
aplicação, tipos de parâmetros, estados, estrutura dinâmica, limites, descarte,
consultas atrasadas, timeout/recuperação e perda do processo.

Os testes de idioma executam dez cenários reais de gettext/GMenu, incluindo
variantes regionais, precedência de `LC_MESSAGES`/`LANGUAGE` e fallback de língua
sem tradução. Incluem uma colisão de texto nativo com uma chave traduzível para
confirmar que o conteúdo do aplicativo não é retraduzido.

Os testes do Shell iniciam GNOME Shell 50.6 real com monitor Wayland virtual e
executam treze grupos de verificações por sessão, no idioma herdado e em pt-BR,
sobre janelas GTK reais e atores do painel. O driver
aciona os itens de menu pelo sinal do ator; não simula cliques físicos do mouse
nem comprova navegação completa de teclado ou acessibilidade.
As verificações geométricas comparam as bordas do título e do dropdown em LTR,
RTL e perto da borda da tela. `reports/alignment.json` registra as coordenadas;
as três capturas `reports/alignment-0.png` a `alignment-2.png` mostram os menus.
Os testes `--real-apps` executam mais cinco grupos por idioma com Nautilus/Ptyxis
reais, incluindo observação da interface das abas em um barramento AT-SPI privado.

O lançador visual também foi executado por seis segundos com o viewer local;
o log confirmou a criação do monitor pelo viewer e a inicialização do Shell.

Resultados da execução mais recente: `reports/verification.json`. A captura de
tela real está em `reports/panel-preview.png`. Logs regenerados ficam em
`reports/dev-session/`; logs da demonstração, em `reports/demo-session/`.
A captura pt-BR está em `reports/panel-preview-pt_BR.png`, e os resultados de
seleção de idioma, em `reports/i18n.json`.

## Evidência local

Ambiente observado em 26/10/2026: Bazzite 44, GNOME Shell 50.6, Wayland.
O relatório `reports/session-initial.json` foi produzido por introspecção D-Bus,
sem ativar aplicativos nem executar comandos de seus menus.

| Aplicativo/serviço | Resultado observado |
| --- | --- |
| Nautilus | 10 ações da aplicação e 13 por janela; nenhuma interface de menu descoberta |
| Ptyxis | 7 ações da aplicação e 2 da janela; nenhuma interface de menu descoberta |
| com.canonical.AppMenu.Registrar | Sem proprietário na sessão |

Ausência de interface descoberta não prova ausência de menus internos. Ações
exportadas não fornecem, sozinhas, rótulos, atalhos e hierarquia de um menu.
Os números descrevem esta sessão, não uma garantia sobre esses aplicativos.

Para repetir:

```bash
python3 tools/probe-session.py
python3 tools/probe-session.py --name org.gnome.Nautilus
```

Requer Python 3, PyGObject e Gio, já presentes neste ambiente. O diagnóstico
percorre até 80 objetos por aplicação e usa timeout de 1 segundo por chamada.
Não identifica a janela em foco. Nomes únicos e caminhos de objetos no relatório
são efêmeros; não devem ser usados como configuração permanente.

## O que o projeto de referência realmente fornece

O [global-menu-KDE](https://github.com/ChathurangaBW/global-menu-KDE) reutiliza o
applet nativo do Plasma e seu importador dbusmenu, acrescentando um menu de
desktop quando não existe menu exportado pelo aplicativo. O rastreamento de
janelas usa LibTaskManager. Não é uma solução universal de extração de menus.

Cópia para estudo: `reference-kde/`, commit
`4a24e4dfed7eac640023e1b28d06321f65385e2b`. Não foi instalada nem executada.
As partes do applet/fallback e a biblioteca vendorizada têm licenças distintas;
qualquer reutilização deve preservar os termos e atribuições dos arquivos.

O [Fildem](https://github.com/gonzaarcr/Fildem) já explora extensão + processo
externo. A [PR 176](https://github.com/gonzaarcr/Fildem/pull/176), intitulada
"Migrate to GNOME 45-50", estava aberta e não integrada na consulta. O título
não comprova funcionamento no nosso GNOME 50.6. Também merece avaliação o
[Fildem-v2](https://github.com/Weather-OS/Fildem-v2), sem assumir compatibilidade.

## Arquitetura inicial e evolução

```text
Implementado:
Extensão GNOME Shell: foco + painel + ciclo de vida
          ↕ Gio assíncrono
GMenuModel + GActionGroup exportados pela aplicação

Implementado e testado sem integração ao painel:
Adaptador DBusMenu assíncrono ↔ exportador de bancada
Registrador AppMenu ↔ conexões independentes de exportadores
Consulta por ID declarado ↔ registrador ↔ fonte DBusMenu correta

Pendente:
Janela do Mutter ↔ identidade comprovada ↔ consulta de registros ↔ painel
```

O primeiro adaptador usa diretamente os proxies assíncronos de Gio em GJS;
não precisou de auxiliar. Python/Gio implementa a bancada. Separar integrações
mais complexas em outro processo continua sendo uma possibilidade, conforme
as necessidades de isolamento e de bibliotecas. Chamadas síncronas e sondagens
extensas não entram no processo do Shell; `probe-session.py` é uma ferramenta
externa de diagnóstico.

1. **Foco:** usar a janela do Mutter na extensão. Avaliar os metadados GTK de
   `Meta.Window` para obter bus name e caminhos de aplicação/janela/menu.
   Não depender de XID como identidade universal nem de inspeção de foco via X11.
2. **GMenu:** consumir menus exportados via `Gio.DBusMenuModel`, e ações via
   `Gio.DBusActionGroup`. A API pública Gio é preferível a implementar diretamente
   o protocolo privado `org.gtk.Menus`.
3. **DBusMenu:** adaptador e registrador independentes implementados para menus,
   eventos, submenus dinâmicos e ciclo de vida dos exportadores. Um registrador tradicional
   por XID não resolve sozinho a associação com superfícies Wayland. A integração
   Qt/Wayland no Mutter é uma questão a validar antes de prometer suporte.
4. **Sem menu:** mostrar indisponibilidade ou ações parciais identificadas como
   tal. Não apresentar uma lista de ações como cópia fiel do menu do aplicativo.
5. **Robustez:** cada troca de foco invalida respostas antigas; vincular fonte ao
   proprietário D-Bus e à janela, cancelar consultas antigas, limpar ao fechar
   janelas ou perder serviços. Abrir o menu do painel deve preservar o alvo.

Referências primárias:

- [Gio.DBusMenuModel](https://docs.gtk.org/gio/class.DBusMenuModel.html)
- [Exportação de GMenuModel](https://github.com/GNOME/glib/blob/main/docs/reference/gio/menu-exporter.md)
- [Meta.Window: caminho GTK da janela](https://gnome.pages.gitlab.gnome.org/mutter/meta/method.Window.get_gtk_window_object_path.html)
- [Contrato dbusmenu na referência](https://github.com/ChathurangaBW/global-menu-KDE/blob/main/third_party/libdbusmenuqt/com.canonical.dbusmenu.xml)

## Cobertura a investigar

| Família | Caminho candidato | Pergunta pendente |
| --- | --- | --- |
| GTK com menubar exportado | Gio | O menu completo e os grupos de ações estão publicados? |
| GTK4/libadwaita sem menubar exportado | Adaptador cooperativo, ações parciais ou acessibilidade | Qual conteúdo existe fora do processo? |
| Qt/KDE | DBusMenu | Como ligar a fonte à janela nativa Wayland no Mutter? |
| Electron | DBusMenu quando disponível | O aplicativo e seu backend gráfico exportam o menu? |
| Firefox/LibreOffice | Avaliação por versão, build e empacotamento | Há exportador ou integração mantida disponível? |
| Flatpak | Testar as mesmas fontes dentro das restrições de D-Bus | A política do aplicativo permite a integração? |

Nenhuma linha desta tabela representa compatibilidade já demonstrada.

## Papel do REA

Usar primeiro código-fonte e protocolos públicos. Quando faltar evidência,
o REA pode observar um aplicativo específico, localizar a construção dos menus,
correlacionar callbacks e confirmar diferenças entre builds. Não foi necessário
usá-lo nesta primeira inspeção de fontes e D-Bus.

Descobrir uma estrutura interna não cria uma interface estável entre processos.
Extração por acessibilidade precisa de ensaio: menus podem ser criados somente
ao abrir, o foco muda e parte dos comandos pode não estar exposta. Instrumentação
ou patches devem ser adaptadores explícitos, com versões e limites conhecidos.

## Marcos e critérios de conclusão

1. **Bancada:** GMenu e DBusMenu implementados e validados em transportes separados.
2. **Primeira extensão (validada na bancada):** GNOME 50, fonte GMenu conhecida, rótulos reais no painel,
   troca entre duas janelas, ativação correta de ações e limpeza ao desabilitar.
   Validar em sessão de desenvolvimento antes da sessão principal.
3. **Compatibilidade:** integrar um aplicativo real de cada família prioritária;
   registrar versão, backend gráfico, origem do pacote e recursos ausentes.
4. **Experiência:** navegação por teclado, alternância ao passar o ponteiro,
   estados de seleção, atalhos, tradução, RTL, HiDPI e múltiplos monitores.
5. **Manutenção:** testes de foco rápido e reinício do auxiliar, limites de tempo,
   relatório de capacidades e documentação para cada versão suportada do Shell.

Para ser considerado primeiro protótipo funcional, o menu precisa executar a
ação da janela correta, refletir estado e sobreviver à troca/fechamento de
janelas. Suporte nativo upstream é um objetivo separado: depende de proposta,
revisão e aceitação pelos projetos GNOME/toolkits, não só de uma extensão pronta.

## Escopo confirmado pelo usuário

O objetivo é a maior abrangência possível entre aplicativos do sistema e
Flatpaks que possam fornecer menus. Os cinco casos iniciais abaixo são uma
amostra de validação, não uma lista que limita o suporte do produto.

| Caso inicial | Instalação local em 26/10/2026 | Evidência e próximo ensaio |
| --- | --- | --- |
| Terminal | Ptyxis 50.1, RPM | Ações exportadas já observadas; investigar o modelo interno e exportação dos menus |
| Arquivos | Nautilus 50.4, RPM | Ações exportadas já observadas; investigar menus contextuais de janela e seleção |
| Signal | org.signal.Signal 8.32.0, Flatpak | Política efetiva permite falar com AppMenu.Registrar; testar exportação real e associação à janela |
| Obsidian | md.obsidian.Obsidian 1.14.5, Flatpak | Política consultada não lista AppMenu.Registrar; investigar fonte de menu e necessidade de integração/permissão específica |
| Firefox | org.mozilla.firefox 158.0.1, Flatpak | Nenhum exportador de menu comprovado; investigar separadamente esta build e as interfaces disponíveis |

Inventário obtido com `flatpak list --app --columns=application,name,version,origin`
e `rpm -q nautilus ptyxis firefox`. As políticas foram lidas com
`flatpak info --show-permissions APP_ID`. Nenhuma permissão foi alterada.
Permissão para falar com um registrador não comprova que o aplicativo exporta
menus, nem que o caminho inverso para ler o menu estará permitido. Ausência de
uma regra nominal não basta para concluir que toda integração é impossível.

### Regras de cobertura

- Integrar protocolos e famílias de aplicativos; evitar limitar a descoberta
  a uma lista de nomes de aplicações.
- Registrar por aplicativo/build/backend/pacote se o suporte é menu completo,
  parcial, adaptador experimental ou indisponível. Não declarar suporte apenas
  por identificar GTK, Qt ou Electron.
- Preservar rótulos, hierarquia, estados, atalhos e comandos do menu de origem
  sempre que a fonte os oferecer. Ações sintéticas devem ser identificadas.
- Só oferecer ocultação do menu original depois de validar uma forma reversível
  e específica para aquela integração. Exibir no painel e remover da janela são
  capacidades independentes; podem não estar disponíveis juntas.
- Manter o menu original acessível se o auxiliar falhar ou a fonte desaparecer,
  quando a integração permitir esse controle. A prova de restauração faz parte
  da validação de qualquer adaptador que oculte menus.
- Tratar Flatpak como formato de distribuição com políticas por aplicativo;
  não como uma família de menus. Validar a comunicação nos dois sentidos e
  documentar permissões mínimas quando forem necessárias.
- Investigar Firefox com evidência da versão instalada. Não prometer que uma
  WebExtension comum ou uma flag de lançamento dará acesso a todo o menu nativo.

Próximo marco: obter uma identidade comprovada da janela no Mutter e ligar o
fluxo de consulta de registros já validado ao painel
para os backends usados por Signal/Obsidian. A bancada dos dois transportes e a
prova de foco/comandos GMenu/GTK no GNOME/Wayland já passaram. Os cinco casos acima
continuam orientando as lacunas de cobertura; nenhum deles foi declarado
compatível com base apenas na bancada.
