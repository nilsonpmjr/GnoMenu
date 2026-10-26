#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""A real GTK application that deliberately exports no menu model."""
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

app = Gtk.Application(application_id='org.example.GnoMenuNoMenu')


def activate(application):
    window = Gtk.ApplicationWindow(application=application,
                                   title='GnoMenu — sem menu exportado',
                                   default_width=400, default_height=180)
    window.set_child(Gtk.Label(label='Este aplicativo não exporta um modelo de menu.'))
    window.present()


app.connect('activate', activate)
raise SystemExit(app.run(None))
