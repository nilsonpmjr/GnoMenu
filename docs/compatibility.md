# Compatibilidade real — GnoMenu

Ambiente validado: GNOME Shell 50.6 / Wayland, Bazzite 44.

| Aplicativo | Versão/pacote | Suporte atual |
| --- | --- | --- |
| Nautilus | 50.4-1.fc44, RPM | Parcial: preferências, sobre/sair, janela/abas, desfazer/refazer, barra lateral, transferências, pasta pessoal e ajuda, quando a ação correspondente está exportada |
| Ptyxis | 50.1-2.fc44, RPM | Parcial: preferências/sobre, nova janela/aba e modo somente leitura da aba atual |
| Outros GTK com ações exportadas | Ainda sem validação individual | Descoberta genérica de ações convencionais de preferências/sobre/sair, quando disponíveis sem parâmetros |
| Aplicativos com GMenu exportado | Validados na bancada | Importação do modelo original tem precedência sobre menus parciais |
| Signal, Obsidian e Firefox | Integração pendente | Não declarados compatíveis nesta etapa |

## O que significa parcial

Nautilus e Ptyxis não publicaram modelos de menu na inspeção desta máquina,
mas publicam grupos de ações. O GnoMenu constrói uma apresentação dessas ações,
com rótulos traduzidos, e identifica o primeiro menu com **Menu parcial**.

Não se trata da captura completa de seus menus originais. Comandos de seleção
de arquivos, copiar/colar e outros comandos internos não exportados continuam
disponíveis nas interfaces dos próprios aplicativos. O GnoMenu não oculta os
menus locais nem inventa atalhos para executar ações que não encontrou.

Os adaptadores só apresentam comandos com nome e tipo de parâmetro compatíveis.
Respeitam o estado habilitado e as seleções publicadas. A identidade da janela
e os caminhos D-Bus vêm dos metadados GTK do Mutter; não se escolhe uma janela
por título ou PID.

## Evidência

`python3 tests/run-shell.py --real-apps` abre duas janelas reais de cada programa
num GNOME/Wayland privado. O Nautilus navega apenas em pastas temporárias vazias.
Os terminais executam `sleep`, sem carregar arquivos de inicialização do shell.

Os testes confirmam:

- O Nautilus é descoberto sem modelo GMenu e recebe o menu parcial localizado.
- Nova aba e Fechar aba executados pelo painel afetam somente a janela escolhida.
  Um observador AT-SPI em barramento privado verifica a alteração da interface.
- O modo somente leitura do Ptyxis muda na janela escolhida, sem alterar a outra,
  e pode ser restaurado pelo menu global.
- Preferências e outros comandos realmente exportados estão disponíveis, e o
  ciclo de vida da extensão remove corretamente as fontes e os botões do painel.

O observador de acessibilidade pertence apenas aos testes; não é necessário
ativar acessibilidade no desktop para usar o GnoMenu. As capturas e observações
ficam em `reports/nautilus-menu.png`, `reports/ptyxis-menu.png` e
`reports/nautilus-tabs.json` depois da verificação completa.

Para experimentar os aplicativos reais numa janela de desenvolvimento:

```bash
python3 tools/dev-session.py --real-apps --locale pt_BR.UTF-8
```

## Desktop principal

A demonstração é outro compositor e outro barramento: aplicativos abertos no
desktop principal não pertencem àquela sessão de desenvolvimento.

Para instalar a extensão no usuário e habilitá-la para o próximo login:

```bash
python3 tools/install-local.py
```

O instalador preserva as demais extensões e não encerra a sessão. No GNOME 50,
uma extensão nova instalada localmente precisa de uma nova sessão para ser
descoberta. A API D-Bus `ReloadExtension` foi conferida no Shell instalado e
responde como não suportada; não usamos avaliação de JavaScript ou alterações
internas do Shell para contornar essa limitação.
