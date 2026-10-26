// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Read only metadata attached to this exact Mutter window. Never guess by PID.
export function sourceForWindow(window) {
    if (!window)
        return null;
    const busName = window.get_gtk_unique_bus_name();
    const menuPath = window.get_gtk_menubar_object_path();
    const appMenuPath = window.get_gtk_app_menu_object_path();
    const appPath = window.get_gtk_application_object_path();
    const windowPath = window.get_gtk_window_object_path();
    if (!busName?.startsWith(':') || (!menuPath && !appMenuPath && !appPath && !windowPath))
        return null;
    return {
        busName,
        menuPath,
        appMenuPath,
        appPath,
        windowPath,
        applicationId: window.get_gtk_application_id?.() ?? null,
    };
}
