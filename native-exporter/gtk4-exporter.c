// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Experimental, opt-in Nautilus 50 exporter. Never preload this into the Shell.
#define _GNU_SOURCE
#include <gtk/gtk.h>
#include <dlfcn.h>
#include <string.h>
G_DEFINE_AUTOPTR_CLEANUP_FUNC(GActionGroup, g_object_unref)

#define GROUPS_KEY "gnomenu-native-groups"
#define WINDOW_KEY "gnomenu-native-window"
#define MAIN_MENU 1u
#define VIEW_MENU 2u
#define FOLDER_MENU 4u
#define REQUIRED_MENUS (MAIN_MENU | VIEW_MENU | FOLDER_MENU)
#define BREADCRUMB_KEY "gnomenu-breadcrumb-context"
#define FILE_VIEW_KEY "gnomenu-file-view-context"
#define FILE_POPUP_KEY "gnomenu-file-popup-context"

typedef struct {
    guint epoch;
    GWeakRef popup;
} FileViewContext;

typedef struct {
    GWeakRef view;
    guint epoch;
    guint token;
    GFile *location;
    GList *selection;
    char *title;
    gboolean invalidated;
} FilePopupContext;

static gboolean file_popup_valid(GtkPopover *popover, guint token);

typedef struct {
    GWeakRef button;
    guint token;
    gboolean ready;
} BreadcrumbContext;

typedef struct {
    GWeakRef origin;
    GWeakRef tab_view;
    GWeakRef tab_page;
    GWeakRef breadcrumb;
    guint breadcrumb_token;
    GWeakRef file_popup;
    guint file_popup_token;
    char *original;
    GSimpleAction *action;
    guint seen;
} Proxy;

typedef struct {
    GWeakRef widget;
    gboolean visible;
} Button;

typedef struct {
    GHashTable *proxies;
    GPtrArray *buttons;
    GMenu *model;
    char *signature;
    GSimpleAction *visibility;
    guint generation;
    guint menus;
    guint menu_kinds;
    guint issues;
    guint remaining;
    GtkWidget *copying_tab_view;
    GObject *copying_tab_page;
    guint copying_tab_token;
    GtkPopover *copying_breadcrumb;
    guint copying_breadcrumb_token;
    GtkPopover *copying_file_popup;
    guint copying_file_token;
} WindowExport;

typedef struct {
    GWeakRef page;
    gboolean local_open;
    gboolean preparing;
} TabContext;

static guint next_tab_token;
static guint next_breadcrumb_token;
static guint next_file_token;

static gboolean breadcrumb_valid(GtkPopover *popover, guint token)
{
    BreadcrumbContext *context = g_object_get_data(G_OBJECT(popover), BREADCRUMB_KEY);
    g_autoptr(GtkWidget) button = context ? g_weak_ref_get(&context->button) : NULL;
    GtkWidget *bar = gtk_widget_get_parent(GTK_WIDGET(popover));
    return context && context->ready && context->token == token && button && bar &&
        gtk_widget_is_ancestor(button, bar) && gtk_widget_get_mapped(button);
}

static void tab_context_free(gpointer data)
{
    TabContext *context = data;
    g_weak_ref_clear(&context->page);
    g_free(context);
}

static void tab_setup_menu(GObject *view, GObject *page, gpointer data)
{
    (void)view;
    TabContext *context = data;
    if (context->preparing)
        return;
    context->local_open = page != NULL;
    // Keep the clicked page after GTK closes its popup to focus the panel.
    if (page)
        g_weak_ref_set(&context->page, page);
}

static void tab_selection_changed(GObject *view, GParamSpec *spec, gpointer data)
{
    (void)view;
    (void)spec;
    g_weak_ref_set(&((TabContext *)data)->page, NULL);
    ((TabContext *)data)->local_open = FALSE;
}

static gboolean tab_contains(GtkWidget *view, GObject *page)
{
    g_autoptr(GListModel) pages = NULL;
    g_object_get(view, "pages", &pages, NULL);
    for (guint i = 0; pages && i < g_list_model_get_n_items(pages); i++) {
        g_autoptr(GObject) candidate = g_list_model_get_item(pages, i);
        if (candidate == page)
            return TRUE;
    }
    return FALSE;
}

static void tab_prepare(GtkWidget *view, GObject *page)
{
    TabContext *context = g_object_get_data(G_OBJECT(view), "gnomenu-tab-context");
    if (context)
        context->preparing = TRUE;
    g_signal_emit_by_name(view, "setup-menu", page);
    if (context)
        context->preparing = FALSE;
}

static void tab_restore(GtkWidget *view)
{
    TabContext *context = g_object_get_data(G_OBJECT(view), "gnomenu-tab-context");
    g_autoptr(GObject) page = context && context->local_open ? g_weak_ref_get(&context->page) : NULL;
    tab_prepare(view, page && tab_contains(view, page) ? page : NULL);
}

static GtkWindow *published_window;
static char *published_signature;
static gboolean enabled;

static void application_startup(GApplication *application, gpointer data)
{
    (void)data;
    if (GTK_IS_APPLICATION(application) &&
        g_strcmp0(g_application_get_application_id(application), "org.gnome.Nautilus") == 0 &&
        !gtk_application_get_menubar(GTK_APPLICATION(application))) {
        GMenu *root = g_menu_new();
        g_object_set_data_full(G_OBJECT(application), "gnomenu-root", root, g_object_unref);
        gtk_application_set_menubar(GTK_APPLICATION(application), G_MENU_MODEL(root));
    }
}

int g_application_run(GApplication *application, int argc, char **argv)
{
    static int (*original)(GApplication *, int, char **);
    if (!original)
        original = dlsym(RTLD_NEXT, "g_application_run");
    if (enabled)
        g_signal_connect(application, "startup", G_CALLBACK(application_startup), NULL);
    return original(application, argc, argv);
}

void gtk_widget_insert_action_group(GtkWidget *widget, const char *name, GActionGroup *group)
{
    static void (*original)(GtkWidget *, const char *, GActionGroup *);
    if (!original)
        original = dlsym(RTLD_NEXT, "gtk_widget_insert_action_group");
    original(widget, name, group);
    if (!enabled || !name)
        return;
    GHashTable *groups = g_object_get_data(G_OBJECT(widget), GROUPS_KEY);
    if (!groups) {
        groups = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_object_unref);
        g_object_set_data_full(G_OBJECT(widget), GROUPS_KEY, groups, (GDestroyNotify)g_hash_table_unref);
    }
    if (group)
        g_hash_table_replace(groups, g_strdup(name), g_object_ref(group));
    else
        g_hash_table_remove(groups, name);
}

static GActionGroup *resolve_group(GtkWidget *origin, const char *full, const char **name)
{
    const char *dot = strchr(full, '.');
    if (!dot)
        return NULL;
    g_autofree char *prefix = g_strndup(full, dot - full);
    *name = dot + 1;
    for (GtkWidget *widget = origin; widget; widget = gtk_widget_get_parent(widget)) {
        if (g_str_equal(prefix, "win") && GTK_IS_APPLICATION_WINDOW(widget) &&
            g_action_group_has_action(G_ACTION_GROUP(widget), *name))
            return g_object_ref(G_ACTION_GROUP(widget));
        if (g_str_equal(prefix, "app") && GTK_IS_APPLICATION_WINDOW(widget)) {
            GtkApplication *app = gtk_window_get_application(GTK_WINDOW(widget));
            if (app && g_action_group_has_action(G_ACTION_GROUP(app), *name))
                return g_object_ref(G_ACTION_GROUP(app));
        }
        GHashTable *groups = g_object_get_data(G_OBJECT(widget), GROUPS_KEY);
        GActionGroup *group = groups ? g_hash_table_lookup(groups, prefix) : NULL;
        if (group && g_action_group_has_action(group, *name))
            return g_object_ref(group);
    }
    return NULL;
}

static void proxy_activate(GSimpleAction *action, GVariant *target, gpointer data)
{
    Proxy *proxy = data;
    g_autoptr(GtkWidget) origin = g_weak_ref_get(&proxy->origin);
    g_autoptr(GtkWidget) tab_view = g_weak_ref_get(&proxy->tab_view);
    g_autoptr(GObject) tab_page = g_weak_ref_get(&proxy->tab_page);
    g_autoptr(GtkPopover) breadcrumb = g_weak_ref_get(&proxy->breadcrumb);
    g_autoptr(GtkPopover) file_popup = g_weak_ref_get(&proxy->file_popup);
    if (proxy->file_popup_token && (!file_popup || !file_popup_valid(file_popup, proxy->file_popup_token)))
        return;
    if (proxy->breadcrumb_token && (!breadcrumb || !breadcrumb_valid(breadcrumb, proxy->breadcrumb_token)))
        return;
    if (g_str_has_prefix(g_action_get_name(G_ACTION(action)), "gnomenu.tab.") &&
        (!tab_view || !tab_page || !tab_contains(tab_view, tab_page)))
        return;
    if (tab_view)
        tab_prepare(tab_view, tab_page);
    const char *name = NULL;
    g_autoptr(GActionGroup) group = origin ? resolve_group(origin, proxy->original, &name) : NULL;
    if (group && g_action_group_get_action_enabled(group, name)) {
        const GVariantType *type = g_action_group_get_action_parameter_type(group, name);
        if ((type && target && g_variant_is_of_type(target, type)) || (!type && !target))
            g_action_group_activate_action(group, name, target);
    }
    if (tab_view)
        tab_restore(tab_view);
}

static void proxy_change(GSimpleAction *action, GVariant *state, gpointer data)
{
    Proxy *proxy = data;
    g_autoptr(GtkPopover) file_popup = g_weak_ref_get(&proxy->file_popup);
    if (proxy->file_popup_token && (!file_popup || !file_popup_valid(file_popup, proxy->file_popup_token)))
        return;
    g_autoptr(GtkWidget) origin = g_weak_ref_get(&proxy->origin);
    const char *name = NULL;
    g_autoptr(GActionGroup) group = origin ? resolve_group(origin, proxy->original, &name) : NULL;
    g_autoptr(GVariant) current = group ? g_action_group_get_action_state(group, name) : NULL;
    if (group && g_action_group_get_action_enabled(group, name) && current &&
        g_variant_is_of_type(state, g_variant_get_type(current)))
        g_action_group_change_action_state(group, name, state);
    (void)action;
}

static void proxy_free(gpointer data)
{
    Proxy *proxy = data;
    g_signal_handlers_disconnect_by_data(proxy->action, proxy);
    g_object_unref(proxy->action);
    g_weak_ref_clear(&proxy->origin);
    g_weak_ref_clear(&proxy->tab_view);
    g_weak_ref_clear(&proxy->tab_page);
    g_weak_ref_clear(&proxy->breadcrumb);
    g_weak_ref_clear(&proxy->file_popup);
    g_free(proxy->original);
    g_free(proxy);
}

static void button_free(gpointer data)
{
    Button *button = data;
    g_weak_ref_clear(&button->widget);
    g_free(button);
}

static void window_free(gpointer data)
{
    WindowExport *export = data;
    g_hash_table_unref(export->proxies);
    g_ptr_array_unref(export->buttons);
    g_clear_object(&export->model);
    if (export->visibility)
        g_signal_handlers_disconnect_by_data(export->visibility, export);
    g_clear_object(&export->visibility);
    g_free(export->signature);
    g_free(export);
}

static void visibility_changed(GSimpleAction *action, GVariant *state, gpointer data)
{
    WindowExport *export = data;
    gboolean visible = g_variant_get_boolean(state);
    for (guint i = 0; i < export->buttons->len; i++) {
        Button *button = g_ptr_array_index(export->buttons, i);
        g_autoptr(GtkWidget) widget = g_weak_ref_get(&button->widget);
        if (widget)
            gtk_widget_set_visible(widget, visible && button->visible);
    }
    g_simple_action_set_state(action, state);
}

static void remember_button(WindowExport *export, GtkWidget *widget)
{
    for (guint i = 0; i < export->buttons->len; i++) {
        Button *button = g_ptr_array_index(export->buttons, i);
        g_autoptr(GtkWidget) previous = g_weak_ref_get(&button->widget);
        if (previous == widget)
            return;
    }
    Button *button = g_new0(Button, 1);
    g_weak_ref_init(&button->widget, widget);
    button->visible = gtk_widget_get_visible(widget);
    g_ptr_array_add(export->buttons, button);
    g_autoptr(GVariant) state = export->visibility ? g_action_get_state(G_ACTION(export->visibility)) : NULL;
    if (state && !g_variant_get_boolean(state))
        gtk_widget_set_visible(widget, FALSE);
}

static char *proxy_name(WindowExport *export, GtkWidget *window, GtkWidget *origin, const char *full)
{
    gboolean tab_action = export->copying_tab_page && g_str_has_prefix(full, "win.");
    if (!strchr(full, '.') || (!export->copying_file_popup &&
        (g_str_has_prefix(full, "app.") || (g_str_has_prefix(full, "win.") && !tab_action))))
        return g_strdup(full);
    const char *name = NULL;
    g_autoptr(GActionGroup) group = resolve_group(origin, full, &name);
    if (!group) {
        export->issues++;
        if (export->generation < 4)
            g_printerr("GNOMENU_UNRESOLVED action=%s origin=%s\n", full, G_OBJECT_TYPE_NAME(origin));
        return g_strdup(full);
    }
    gboolean breadcrumb_action = export->copying_breadcrumb && g_str_has_prefix(full, "pathbar.");
    g_autofree char *local = tab_action ? g_strdup_printf("gnomenu.tab.%u.%s", export->copying_tab_token, name) :
        breadcrumb_action ? g_strdup_printf("gnomenu.pathbar.%u.%s", export->copying_breadcrumb_token, name) :
        export->copying_file_popup ? g_strdup_printf("gnomenu.files.%u.%s", export->copying_file_token, full) :
        g_strconcat("gnomenu.", full, NULL);
    Proxy *proxy = g_hash_table_lookup(export->proxies, local);
    const GVariantType *parameter = g_action_group_get_action_parameter_type(group, name);
    g_autoptr(GVariant) state = g_action_group_get_action_state(group, name);
    if (proxy) {
        const GVariantType *old_parameter = g_action_get_parameter_type(G_ACTION(proxy->action));
        const GVariantType *old_state = g_action_get_state_type(G_ACTION(proxy->action));
        const GVariantType *new_state = state ? g_variant_get_type(state) : NULL;
        if ((parameter == NULL) != (old_parameter == NULL) ||
            (parameter && old_parameter && !g_variant_type_equal(parameter, old_parameter)) ||
            (new_state == NULL) != (old_state == NULL) ||
            (new_state && old_state && !g_variant_type_equal(new_state, old_state))) {
            // GSimpleAction types are immutable: replace, never keep a stale contract.
            g_action_map_remove_action(G_ACTION_MAP(window), local);
            g_hash_table_remove(export->proxies, local);
            proxy = NULL;
        }
    }
    if (!proxy) {
        proxy = g_new0(Proxy, 1);
        g_weak_ref_init(&proxy->origin, origin);
        g_weak_ref_init(&proxy->tab_view, tab_action ? export->copying_tab_view : NULL);
        g_weak_ref_init(&proxy->tab_page, tab_action ? export->copying_tab_page : NULL);
        g_weak_ref_init(&proxy->breadcrumb, breadcrumb_action ? export->copying_breadcrumb : NULL);
        proxy->breadcrumb_token = breadcrumb_action ? export->copying_breadcrumb_token : 0;
        g_weak_ref_init(&proxy->file_popup, export->copying_file_popup);
        proxy->file_popup_token = export->copying_file_popup ? export->copying_file_token : 0;
        proxy->original = g_strdup(full);
        proxy->action = state ? g_simple_action_new_stateful(local, parameter, state) :
            g_simple_action_new(local, parameter);
        g_signal_connect(proxy->action, "activate", G_CALLBACK(proxy_activate), proxy);
        g_signal_connect(proxy->action, "change-state", G_CALLBACK(proxy_change), proxy);
        g_action_map_add_action(G_ACTION_MAP(window), G_ACTION(proxy->action));
        g_hash_table_insert(export->proxies, g_strdup(local), proxy);
    }
    proxy->seen = export->generation;
    g_weak_ref_set(&proxy->origin, origin);
    g_simple_action_set_enabled(proxy->action, g_action_group_get_action_enabled(group, name));
    const GVariantType *state_type = g_action_get_state_type(G_ACTION(proxy->action));
    if (state && state_type && g_variant_is_of_type(state, state_type))
        g_simple_action_set_state(proxy->action, state);
    return g_strconcat("win.", local, NULL);
}

static GtkWidget *find_custom(GtkWidget *widget, const char *id)
{
    // These two native custom slots are defined by nautilus-view-controls.blp.
    // Read their actual widget actions and tooltips; do not invent captions.
    if (GTK_IS_ACTIONABLE(widget) &&
        (g_str_equal(id, "zoom-in") || g_str_equal(id, "zoom-out"))) {
        const char *action = gtk_actionable_get_action_name(GTK_ACTIONABLE(widget));
        g_autofree char *expected = g_strconcat("view.", id, NULL);
        if (g_strcmp0(action, expected) == 0)
            return widget;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
        GtkWidget *found = find_custom(child, id);
        if (found)
            return found;
    }
    return NULL;
}

static GMenu *copy_menu(WindowExport *export, GtkWidget *window, GtkWidget *origin,
                        GtkWidget *popover, GMenuModel *model, GString *signature, guint depth)
{
    GMenu *copy = g_menu_new();
    if (depth > 12) {
        export->issues++;
        return copy;
    }
    for (gint i = 0; i < g_menu_model_get_n_items(model); i++) {
        if (!export->remaining) {
            export->issues++;
            break;
        }
        export->remaining--;
        g_autoptr(GVariant) custom = g_menu_model_get_item_attribute_value(model, i, "custom", G_VARIANT_TYPE_STRING);
        g_autoptr(GMenuItem) item = g_menu_item_new(NULL, NULL);
        g_autoptr(GMenuAttributeIter) attributes = g_menu_model_iterate_item_attributes(model, i);
        const char *name;
        GVariant *value;
        g_string_append_c(signature, '[');
        while (g_menu_attribute_iter_get_next(attributes, &name, &value)) {
            g_autofree char *printed = g_variant_print(value, TRUE);
            g_string_append_printf(signature, "%s=%s;", name, printed);
            if (!custom && g_str_equal(name, "action") && g_variant_is_of_type(value, G_VARIANT_TYPE_STRING)) {
                g_autofree char *mapped = proxy_name(export, window, origin, g_variant_get_string(value, NULL));
                g_menu_item_set_attribute(item, "action", "s", mapped);
                g_string_append_printf(signature, "mapped=%s;", mapped);
            } else {
                g_menu_item_set_attribute_value(item, name, value);
            }
            g_variant_unref(value);
        }
        if (custom) {
            GtkWidget *widget = find_custom(popover, g_variant_get_string(custom, NULL));
            const char *caption = widget ? gtk_widget_get_tooltip_text(widget) : NULL;
            if (!widget || !caption) {
                export->issues++;
                g_string_append(signature, "unsupported-custom]");
                continue;
            }
            const char *action = gtk_actionable_get_action_name(GTK_ACTIONABLE(widget));
            g_autofree char *mapped = proxy_name(export, window, origin, action);
            g_menu_item_set_attribute_value(item, "custom", NULL);
            g_menu_item_set_label(item, caption);
            g_menu_item_set_attribute(item, "action", "s", mapped);
            g_string_append_printf(signature, "widget=%s/%s;", caption, mapped);
        }
        g_autoptr(GMenuLinkIter) links = g_menu_model_iterate_item_links(model, i);
        GMenuModel *linked;
        while (g_menu_link_iter_get_next(links, &name, &linked)) {
            g_string_append_printf(signature, "link=%s;", name);
            g_autoptr(GMenu) child = copy_menu(export, window, origin, popover, linked, signature, depth + 1);
            g_menu_item_set_link(item, name, G_MENU_MODEL(child));
            g_object_unref(linked);
        }
        g_string_append_c(signature, ']');
        g_menu_append_item(copy, item);
    }
    return copy;
}

static gboolean has_action(GMenuModel *model, const char *action, guint depth)
{
    if (depth > 12)
        return FALSE;
    for (gint i = 0; i < g_menu_model_get_n_items(model); i++) {
        g_autoptr(GVariant) value = g_menu_model_get_item_attribute_value(model, i, "action", G_VARIANT_TYPE_STRING);
        if (value && g_str_equal(g_variant_get_string(value, NULL), action))
            return TRUE;
        g_autoptr(GMenuLinkIter) links = g_menu_model_iterate_item_links(model, i);
        const char *name;
        GMenuModel *linked;
        while (g_menu_link_iter_get_next(links, &name, &linked)) {
            gboolean found = has_action(linked, action, depth + 1);
            g_object_unref(linked);
            if (found)
                return TRUE;
        }
    }
    return FALSE;
}

static void file_view_free(gpointer data)
{
    FileViewContext *context = data;
    g_weak_ref_clear(&context->popup);
    g_free(context);
}

static void file_view_changed(GObject *view, GParamSpec *spec, gpointer data)
{
    (void)view;
    (void)spec;
    FileViewContext *context = data;
    g_autoptr(GtkPopover) popup = g_weak_ref_get(&context->popup);
    FilePopupContext *capture = popup ? g_object_get_data(G_OBJECT(popup), FILE_POPUP_KEY) : NULL;
    // Nautilus can notify selection after opening a popup even when the actual
    // selection is unchanged. Retire only a genuinely different context.
    if (!capture || !file_popup_valid(popup, capture->token))
        context->epoch++;
}

static FileViewContext *file_view_watch(GtkWidget *view)
{
    FileViewContext *context = g_object_get_data(G_OBJECT(view), FILE_VIEW_KEY);
    if (!context) {
        context = g_new0(FileViewContext, 1);
        g_weak_ref_init(&context->popup, NULL);
        g_object_set_data_full(G_OBJECT(view), FILE_VIEW_KEY, context, file_view_free);
        g_signal_connect(view, "notify::selection", G_CALLBACK(file_view_changed), context);
        g_signal_connect(view, "notify::location", G_CALLBACK(file_view_changed), context);
        g_signal_connect(view, "notify::loading", G_CALLBACK(file_view_changed), context);
    }
    return context;
}

static void selected_name_changed(GObject *file, GParamSpec *spec, gpointer data)
{
    (void)file;
    (void)spec;
    // A rename can keep the same selected GObject while changing its identity
    // as presented in the panel. Never keep the old named context actionable.
    ((FilePopupContext *)data)->invalidated = TRUE;
}

static void file_popup_free(gpointer data)
{
    FilePopupContext *capture = data;
    g_weak_ref_clear(&capture->view);
    g_clear_object(&capture->location);
    for (GList *item = capture->selection; item; item = item->next)
        g_signal_handlers_disconnect_by_data(item->data, capture);
    // Nautilus 50.4's public selection getter transfers a list of GObject refs.
    g_list_free_full(capture->selection, g_object_unref);
    g_free(capture->title);
    g_free(capture);
}

static gboolean file_popup_valid(GtkPopover *popover, guint token)
{
    FilePopupContext *capture = g_object_get_data(G_OBJECT(popover), FILE_POPUP_KEY);
    g_autoptr(GtkWidget) view = capture ? g_weak_ref_get(&capture->view) : NULL;
    if (!view || capture->invalidated || capture->token != token || !gtk_widget_get_mapped(view))
        return FALSE;
    FileViewContext *context = g_object_get_data(G_OBJECT(view), FILE_VIEW_KEY);
    g_autoptr(GtkPopover) current = context ? g_weak_ref_get(&context->popup) : NULL;
    if (!context || context->epoch != capture->epoch || current != popover)
        return FALSE;
    gboolean loading = TRUE;
    g_autoptr(GFile) location = NULL;
    GList *selection = NULL;
    g_object_get(view, "loading", &loading, "location", &location, "selection", &selection, NULL);
    gboolean valid = !loading && location && capture->location && g_file_equal(location, capture->location);
    GList *a = selection, *b = capture->selection;
    while (valid && a && b) {
        valid = a->data == b->data;
        a = a->next;
        b = b->next;
    }
    valid = valid && !a && !b;
    g_list_free_full(selection, g_object_unref);
    return valid;
}

static void capture_file_popup(GtkPopover *popover)
{
    if (!GTK_IS_POPOVER_MENU(popover))
        return;
    GtkWidget *view = gtk_widget_get_parent(GTK_WIDGET(popover));
    GType view_type = g_type_from_name("NautilusFilesView");
    GMenuModel *model = gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover));
    if (!view || !view_type || !g_type_is_a(G_OBJECT_TYPE(view), view_type) || !model ||
        (!has_action(model, "view.copy", 0) && !has_action(model, "view.new-folder", 0)))
        return;
    FileViewContext *context = file_view_watch(view);
    FilePopupContext *capture = g_new0(FilePopupContext, 1);
    g_weak_ref_init(&capture->view, view);
    capture->epoch = context->epoch;
    capture->token = ++next_file_token;
    g_object_get(view, "location", &capture->location, "selection", &capture->selection, NULL);
    if (capture->selection && g_list_length(capture->selection) <= 128) {
        g_autoptr(GString) title = g_string_new(NULL);
        for (GList *item = capture->selection; item; item = item->next) {
            g_autofree char *name = NULL;
            g_object_get(item->data, "display-name", &name, NULL);
            g_signal_connect(item->data, "notify::display-name", G_CALLBACK(selected_name_changed), capture);
            if (title->len)
                g_string_append(title, ", ");
            g_string_append(title, name ? name : "");
        }
        capture->title = g_strdup(title->str);
    } else if (!capture->selection) {
        GtkRoot *root = gtk_widget_get_root(view);
        if (GTK_IS_WINDOW(root))
            capture->title = g_strdup(gtk_window_get_title(GTK_WINDOW(root)));
    }
    g_object_set_data_full(G_OBJECT(popover), FILE_POPUP_KEY, capture, file_popup_free);
    g_weak_ref_set(&context->popup, popover);
    g_printerr("GNOMENU_FILE_CAPTURE token=%u epoch=%u selected=%u\n", capture->token, capture->epoch,
        g_list_length(capture->selection));
}

static void collect_file_popup(WindowExport *export, GtkWidget *window, GtkPopover *popover,
                               GMenu *root, GString *signature)
{
    FilePopupContext *capture = g_object_get_data(G_OBJECT(popover), FILE_POPUP_KEY);
    if (!capture || !capture->title || !*capture->title || !file_popup_valid(popover, capture->token))
        return;
    g_autoptr(GtkWidget) view = g_weak_ref_get(&capture->view);
    export->copying_file_popup = popover;
    export->copying_file_token = capture->token;
    g_string_append_printf(signature, "files=%u/%s;", capture->token, capture->title);
    GMenuModel *model = gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover));
    g_autoptr(GMenu) copy = copy_menu(export, window, view, GTK_WIDGET(popover), model, signature, 0);
    export->copying_file_popup = NULL;
    g_auto(GStrv) parts = g_strsplit(capture->title, "_", -1);
    g_autofree char *caption = g_strjoinv("__", parts);
    g_menu_append_submenu(root, caption, G_MENU_MODEL(copy));
}

static gboolean is_breadcrumb_popover(GtkPopover *popover)
{
    GtkWidget *bar = gtk_widget_get_parent(GTK_WIDGET(popover));
    GMenuModel *model = GTK_IS_POPOVER_MENU(popover) ?
        gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover)) : NULL;
    return bar && g_str_equal(G_OBJECT_TYPE_NAME(bar), "NautilusPathBar") && model &&
        has_action(model, "pathbar.open-item-new-tab", 0) && has_action(model, "pathbar.properties", 0);
}

static void breadcrumb_free(gpointer data)
{
    BreadcrumbContext *context = data;
    g_weak_ref_clear(&context->button);
    g_free(context);
}

static GtkWidget *breadcrumb_at(GtkWidget *widget, GtkWidget *bar, const graphene_point_t *point)
{
    if (GTK_IS_BUTTON(widget) && gtk_widget_has_css_class(widget, "nautilus-path-button")) {
        graphene_rect_t bounds;
        if (gtk_widget_compute_bounds(widget, bar, &bounds) && graphene_rect_contains_point(&bounds, point))
            return widget;
    }
    // Popovers belong to the pathbar too, but are never breadcrumb buttons.
    if (GTK_IS_POPOVER(widget))
        return NULL;
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
        GtkWidget *found = breadcrumb_at(child, bar, point);
        if (found)
            return found;
    }
    return NULL;
}

void gtk_popover_set_pointing_to(GtkPopover *popover, const GdkRectangle *rectangle)
{
    static void (*original)(GtkPopover *, const GdkRectangle *);
    if (!original)
        original = dlsym(RTLD_NEXT, "gtk_popover_set_pointing_to");
    if (enabled && is_breadcrumb_popover(popover)) {
        BreadcrumbContext *context = g_object_get_data(G_OBJECT(popover), BREADCRUMB_KEY);
        if (!context) {
            context = g_new0(BreadcrumbContext, 1);
            g_weak_ref_init(&context->button, NULL);
            g_object_set_data_full(G_OBJECT(popover), BREADCRUMB_KEY, context, breadcrumb_free);
        }
        // Nautilus changes its private context after this call, potentially
        // waiting for file metadata. Retire the previous aliases immediately.
        context->ready = FALSE;
        context->token = ++next_breadcrumb_token;
        GtkWidget *bar = gtk_widget_get_parent(GTK_WIDGET(popover));
        graphene_point_t point = GRAPHENE_POINT_INIT(rectangle ? rectangle->x : -1, rectangle ? rectangle->y : -1);
        g_weak_ref_set(&context->button, rectangle ? breadcrumb_at(bar, bar, &point) : NULL);
    }
    original(popover, rectangle);
}

void gtk_popover_popup(GtkPopover *popover)
{
    static void (*original)(GtkPopover *);
    if (!original)
        original = dlsym(RTLD_NEXT, "gtk_popover_popup");
    original(popover);
    if (enabled)
        capture_file_popup(popover);
    if (enabled && is_breadcrumb_popover(popover)) {
        BreadcrumbContext *context = g_object_get_data(G_OBJECT(popover), BREADCRUMB_KEY);
        if (context)
            context->ready = TRUE;
    }
}

static void collect_breadcrumb_menu(WindowExport *export, GtkWidget *window, GtkPopover *popover,
                                    GMenu *root, GString *signature)
{
    BreadcrumbContext *context = g_object_get_data(G_OBJECT(popover), BREADCRUMB_KEY);
    if (!context || !breadcrumb_valid(popover, context->token))
        return;
    g_autoptr(GtkWidget) button = g_weak_ref_get(&context->button);
    const char *title = gtk_widget_get_tooltip_text(button);
    if (!title || !*title)
        return;
    GtkWidget *bar = gtk_widget_get_parent(GTK_WIDGET(popover));
    GMenuModel *model = gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover));
    export->copying_breadcrumb = popover;
    export->copying_breadcrumb_token = context->token;
    g_string_append_printf(signature, "breadcrumb=%u/%s;", context->token, title);
    g_autoptr(GMenu) copy = copy_menu(export, window, bar, GTK_WIDGET(popover), model, signature, 0);
    export->copying_breadcrumb = NULL;
    g_auto(GStrv) parts = g_strsplit(title, "_", -1);
    g_autofree char *caption = g_strjoinv("__", parts);
    g_menu_append_submenu(root, caption, G_MENU_MODEL(copy));
}

static void collect_tab_menu(WindowExport *export, GtkWidget *window, GtkWidget *view,
                             GMenu *root, GString *signature)
{
    gint count = 0;
    g_autoptr(GMenuModel) model = NULL;
    g_autoptr(GObject) selected = NULL;
    g_object_get(view, "n-pages", &count, "menu-model", &model, "selected-page", &selected, NULL);
    TabContext *context = g_object_get_data(G_OBJECT(view), "gnomenu-tab-context");
    if (!context) {
        context = g_new0(TabContext, 1);
        g_weak_ref_init(&context->page, NULL);
        g_object_set_data_full(G_OBJECT(view), "gnomenu-tab-context", context, tab_context_free);
        g_signal_connect(view, "setup-menu", G_CALLBACK(tab_setup_menu), context);
        g_signal_connect(view, "notify::selected-page", G_CALLBACK(tab_selection_changed), context);
    }
    if (count < 2 || !model || !has_action(model, "win.close-current-view", 0))
        return;
    g_autoptr(GObject) page = g_weak_ref_get(&context->page);
    if (!page || !tab_contains(view, page))
        g_set_object(&page, selected);
    if (!page)
        return;
    g_autofree char *title = NULL;
    g_object_get(page, "title", &title, NULL);
    if (!title || !*title)
        return;
    guint token = GPOINTER_TO_UINT(g_object_get_data(page, "gnomenu-tab-token"));
    if (!token) {
        token = ++next_tab_token;
        g_object_set_data(page, "gnomenu-tab-token", GUINT_TO_POINTER(token));
    }
    export->copying_tab_view = view;
    export->copying_tab_page = page;
    export->copying_tab_token = token;
    // Let Nautilus calculate availability for this exact page, just as it does
    // before displaying its local context menu. Restore its normal state after.
    tab_prepare(view, page);
    g_string_append_printf(signature, "tab=%u/%s;", token, title);
    g_autoptr(GMenu) copy = copy_menu(export, window, view, NULL, model, signature, 0);
    tab_restore(view);
    export->copying_tab_view = NULL;
    export->copying_tab_page = NULL;
    // GMenu labels use mnemonic underscores; tab titles are literal filenames.
    g_auto(GStrv) title_parts = g_strsplit(title, "_", -1);
    g_autofree char *menu_title = g_strjoinv("__", title_parts);
    g_menu_append_submenu(root, menu_title, G_MENU_MODEL(copy));
}

static void collect_menus(WindowExport *export, GtkWidget *window, GtkWidget *widget,
                          GMenu *root, GString *signature, guint depth)
{
    if (depth > 40)
        return;
    // GTK may render our exported menubar itself after responsive layout changes.
    // Its generated buttons are consumers, never additional native sources.
    if (GTK_IS_POPOVER_MENU_BAR(widget))
        return;
    if (GTK_IS_POPOVER_MENU(widget))
        collect_file_popup(export, window, GTK_POPOVER(widget), root, signature);
    if (GTK_IS_POPOVER_MENU(widget) && is_breadcrumb_popover(GTK_POPOVER(widget)))
        collect_breadcrumb_menu(export, window, GTK_POPOVER(widget), root, signature);
    if (g_str_equal(G_OBJECT_TYPE_NAME(widget), "AdwTabView"))
        collect_tab_menu(export, window, widget, root, signature);
    gboolean captured = FALSE;
    for (guint i = 0; i < export->buttons->len; i++) {
        Button *button = g_ptr_array_index(export->buttons, i);
        g_autoptr(GtkWidget) previous = g_weak_ref_get(&button->widget);
        if (previous == widget)
            captured = TRUE;
    }
    if (GTK_IS_MENU_BUTTON(widget) && (gtk_widget_get_mapped(widget) || captured)) {
        GtkPopover *popover = gtk_menu_button_get_popover(GTK_MENU_BUTTON(widget));
        GMenuModel *model = gtk_menu_button_get_menu_model(GTK_MENU_BUTTON(widget));
        if (!model && GTK_IS_POPOVER_MENU(popover))
            model = gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover));
        guint kind = !model ? 0 : has_action(model, "app.clone-window", 0) ? MAIN_MENU :
            has_action(model, "view.show-hidden-files", 0) ? VIEW_MENU :
            has_action(model, "view.current-directory-properties", 0) &&
            has_action(model, "slot.reload", 0) ? FOLDER_MENU : 0;
        if (kind) {
            const char *caption = gtk_widget_get_tooltip_text(widget);
            if (caption && *caption) {
                // Nautilus has header and bottom-bar View Options controls for
                // responsive layouts. Own both originals, publish the menu once.
                remember_button(export, widget);
                if (!(export->menu_kinds & kind)) {
                    g_autoptr(GMenu) copy = copy_menu(export, window, widget, GTK_WIDGET(popover), model, signature, 0);
                    g_string_append_printf(signature, "menu=%s;", caption);
                    g_menu_append_submenu(root, caption, G_MENU_MODEL(copy));
                    export->menu_kinds |= kind;
                    export->menus++;
                }
            } else {
                export->issues++;
            }
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child))
        collect_menus(export, window, child, root, signature, depth + 1);
}

static gboolean scan(gpointer data)
{
    (void)data;
    GListModel *windows = gtk_window_get_toplevels();
    for (guint i = 0; i < g_list_model_get_n_items(windows); i++) {
        g_autoptr(GtkWindow) window = g_list_model_get_item(windows, i);
        if (!GTK_IS_APPLICATION_WINDOW(window))
            continue;
        GtkApplication *app = gtk_window_get_application(window);
        if (!app || g_strcmp0(g_application_get_application_id(G_APPLICATION(app)), "org.gnome.Nautilus") != 0)
            continue;
        // A pre-existing application menubar belongs to its original exporter.
        if (!g_object_get_data(G_OBJECT(app), "gnomenu-root"))
            continue;
        WindowExport *export = g_object_get_data(G_OBJECT(window), WINDOW_KEY);
        if (!export) {
            export = g_new0(WindowExport, 1);
            export->proxies = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, proxy_free);
            export->buttons = g_ptr_array_new_with_free_func(button_free);
            g_object_set_data_full(G_OBJECT(window), WINDOW_KEY, export, window_free);
        }
        export->generation++;
        export->menus = export->issues = export->menu_kinds = 0;
        export->remaining = 512;
        g_autoptr(GMenu) root = g_menu_new();
        g_autoptr(GString) signature = g_string_new(NULL);
        collect_menus(export, GTK_WIDGET(window), GTK_WIDGET(window), root, signature, 0);
        GHashTableIter iter;
        gpointer key, value;
        g_hash_table_iter_init(&iter, export->proxies);
        while (g_hash_table_iter_next(&iter, &key, &value)) {
            Proxy *proxy = value;
            if (proxy->seen != export->generation) {
                g_action_map_remove_action(G_ACTION_MAP(window), key);
                g_hash_table_iter_remove(&iter);
            }
        }
        if (g_strcmp0(export->signature, signature->str) != 0) {
            g_set_object(&export->model, root);
            g_free(export->signature);
            export->signature = g_strdup(signature->str);
            g_printerr("GNOMENU_EXPORT window=%u menus=%u proxies=%u unresolved=%u\n",
                       gtk_application_window_get_id(GTK_APPLICATION_WINDOW(window)), export->menus,
                       g_hash_table_size(export->proxies), export->issues);
        }
        if (export->menu_kinds == REQUIRED_MENUS && export->issues == 0 && !export->visibility &&
            !g_action_map_lookup_action(G_ACTION_MAP(window), "show-menubar")) {
            export->visibility = g_simple_action_new_stateful("show-menubar", NULL, g_variant_new_boolean(TRUE));
            g_signal_connect(export->visibility, "change-state", G_CALLBACK(visibility_changed), export);
            g_action_map_add_action(G_ACTION_MAP(window), G_ACTION(export->visibility));
        }
        if (export->visibility && (export->issues || export->menu_kinds != REQUIRED_MENUS)) {
            g_action_group_change_action_state(G_ACTION_GROUP(window), "show-menubar", g_variant_new_boolean(TRUE));
            g_action_map_remove_action(G_ACTION_MAP(window), "show-menubar");
            g_signal_handlers_disconnect_by_data(export->visibility, export);
            g_clear_object(&export->visibility);
        }
        GMenu *shared_root = g_object_get_data(G_OBJECT(app), "gnomenu-root");
        if (shared_root && export->model && gtk_application_get_active_window(app) == window &&
            (published_window != window || g_strcmp0(published_signature, export->signature) != 0)) {
            if (published_window)
                g_object_remove_weak_pointer(G_OBJECT(published_window), (gpointer *)&published_window);
            published_window = window;
            g_object_add_weak_pointer(G_OBJECT(window), (gpointer *)&published_window);
            g_free(published_signature);
            published_signature = g_strdup(export->signature);
            g_menu_remove_all(shared_root);
            for (gint item = 0; item < g_menu_model_get_n_items(G_MENU_MODEL(export->model)); item++) {
                g_autoptr(GMenuItem) copy = g_menu_item_new_from_model(G_MENU_MODEL(export->model), item);
                g_menu_append_item(shared_root, copy);
            }
        }
    }
    return G_SOURCE_CONTINUE;
}

__attribute__((constructor)) static void initialize(void)
{
    enabled = g_strcmp0(g_getenv("GNOMENU_NATIVE_EXPORT"), "1") == 0;
    if (enabled)
        g_timeout_add(200, scan, NULL);
}
