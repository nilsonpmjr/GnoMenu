#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Two real GTK/Wayland windows with exported GMenu and scoped commands."""
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gio, GLib, Gtk


class Demo(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='org.example.GnoMenuDemo')
        self.windows_created = False

    def do_startup(self):
        Gtk.Application.do_startup(self)
        root = Gio.Menu()
        file_menu = Gio.Menu()
        file_menu.append('Incrementar esta janela', 'win.increment')
        file_menu.append('Adicionar comando dinâmico', 'app.dynamic')
        file_menu.append('Comando inicialmente desabilitado', 'win.blocked')
        file_menu.append('Habilitar comando', 'win.enable')
        file_menu.append('Fechar esta janela', 'win.close')
        root.append_submenu('_Arquivo', file_menu)
        view = Gio.Menu()
        view.append('Marcar opção', 'win.checked')
        view.append('Modo um', 'win.mode::one')
        view.append('Modo dois', 'win.mode::two')
        root.append_submenu('_Exibir', view)
        self.set_menubar(root)
        self.set_accels_for_action('win.increment', ['<Primary>i'])
        dynamic = Gio.SimpleAction.new('dynamic', None)
        dynamic.connect('activate', lambda *_: file_menu.append('Incrementar (dinâmico)', 'win.increment'))
        self.add_action(dynamic)
        self.preferences_count = Gio.SimpleAction.new_stateful('preferences-count', None, GLib.Variant('i', 0))
        self.add_action(self.preferences_count)
        option = Gio.SimpleAction.new_stateful('option', None, GLib.Variant('b', False))
        self.add_action(option)
        preferences = Gio.SimpleAction.new('preferences', None)
        preferences.connect('activate', self.open_preferences)
        self.add_action(preferences)
        about = Gio.SimpleAction.new('about', None)
        about.connect('activate', lambda *_: self.dialog('Sobre o GnoMenu Demo',
            Gtk.Label(label='Aplicativo de bancada do GnoMenu.')))
        self.add_action(about)
        quit_action = Gio.SimpleAction.new('quit', None)
        quit_action.connect('activate', lambda *_: self.quit())
        self.add_action(quit_action)

    def dialog(self, title, child):
        window = Gtk.Window(application=self, title=title, transient_for=self.get_active_window(),
                            default_width=380, default_height=160)
        child.set_margin_top(24)
        child.set_margin_bottom(24)
        child.set_margin_start(24)
        child.set_margin_end(24)
        window.set_child(child)
        window.present()

    def open_preferences(self, *_):
        self.preferences_count.set_state(GLib.Variant('i', self.preferences_count.get_state().unpack() + 1))
        self.dialog('Configurações do GnoMenu Demo',
                    Gtk.CheckButton(label='Opção de demonstração', action_name='app.option'))

    def do_activate(self):
        if not self.windows_created:
            self.windows_created = True
            for number in (1, 2):
                self.create_window(number)
        else:
            for window in self.get_windows():
                window.present()

    def create_window(self, number):
        window = Gtk.ApplicationWindow(application=self,
                                       title=f'GnoMenu — janela {number}',
                                       default_width=480, default_height=260,
                                       show_menubar=True)
        count = 0
        counter = Gio.SimpleAction.new_stateful('counter', None, GLib.Variant('i', 0))
        window.add_action(counter)
        menubar = Gio.SimpleAction.new_stateful('show-menubar', None, GLib.Variant('b', True))

        def show_menubar(action, value):
            window.set_show_menubar(value.unpack())
            action.set_state(GLib.Variant('b', window.get_show_menubar()))

        menubar.connect('change-state', show_menubar)
        window.add_action(menubar)
        status = Gtk.Label(label=f'Janela {number}: 0 comandos recebidos')
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16,
                      margin_top=24, margin_bottom=24, margin_start=24, margin_end=24)
        box.append(Gtk.Label(label='Use Arquivo e Exibir no painel global.'))
        box.append(status)
        button = Gtk.Button(label='Incrementar localmente', action_name='win.increment')
        box.append(button)
        window.set_child(box)
        increment = Gio.SimpleAction.new('increment', None)

        def update(*_):
            nonlocal count
            count += 1
            counter.set_state(GLib.Variant('i', count))
            status.set_label(f'Janela {number}: {count} comandos recebidos')
            print(f'WINDOW {number} COUNT {count}', flush=True)

        increment.connect('activate', update)
        window.add_action(increment)
        checked = Gio.SimpleAction.new_stateful('checked', None, GLib.Variant('b', False))
        window.add_action(checked)
        mode = Gio.SimpleAction.new_stateful('mode', GLib.VariantType.new('s'), GLib.Variant('s', 'one'))
        window.add_action(mode)
        blocked = Gio.SimpleAction.new('blocked', None)
        blocked.set_enabled(False)
        blocked.connect('activate', update)
        window.add_action(blocked)
        enable = Gio.SimpleAction.new('enable', None)
        enable.connect('activate', lambda *_: blocked.set_enabled(True))
        window.add_action(enable)
        close = Gio.SimpleAction.new('close', None)
        close.connect('activate', lambda *_: window.close())
        window.add_action(close)
        window.present()


app = Demo()
raise SystemExit(app.run(None))
