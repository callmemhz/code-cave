use crate::db::{self, Db};
use tauri::{
    menu::{
        CheckMenuItemBuilder, MenuBuilder, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Runtime,
};

pub const BG_THEME_KEY: &str = "bg_theme";
pub const DEFAULT_THEME: &str = "waves";

// (menu_id, theme_id, label, accelerator)
const THEMES: &[(&str, &str, &str, Option<&str>)] = &[
    ("bg_off", "off", "Off", None),
    ("bg_dots", "dots", "Dots (Classic)", None),
    ("bg_waves", "waves", "Waves", None),
    ("bg_matrix", "matrix", "Matrix", None),
    ("bg_rain", "rain", "Rain", None),
    ("bg_starfield", "starfield", "Starfield", None),
    ("bg_plasma", "plasma", "Plasma", None),
];

fn theme_for_menu_id(id: &str) -> Option<&'static str> {
    THEMES
        .iter()
        .find(|(m, _, _, _)| *m == id)
        .map(|(_, t, _, _)| *t)
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let current = {
        let db = app.state::<Db>();
        db::app_state::get(&db, BG_THEME_KEY)
            .ok()
            .flatten()
            .unwrap_or_else(|| DEFAULT_THEME.to_string())
    };

    // First submenu becomes the macOS app menu.
    // Custom "cc_quit" item (not PredefinedMenuItem::quit) so we can route
    // through RunEvent::ExitRequested → renderer confirm modal instead of
    // NSApp.terminate'ing without warning.
    let quit_item = MenuItem::with_id(app, "cc_quit", "Quit Code Cave", true, Some("Cmd+Q"))?;
    let app_menu = SubmenuBuilder::new(app, "code-cave")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&quit_item)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // Build the Background submenu with one CheckMenuItem per theme.
    let mut bg_builder = SubmenuBuilder::new(app, "Background");
    for (mid, theme, label, accel) in THEMES {
        let mut b = CheckMenuItemBuilder::with_id(*mid, *label)
            .checked(current.as_str() == *theme);
        if let Some(a) = accel {
            b = b.accelerator(*a);
        }
        let item = b.build(app)?;
        bg_builder = bg_builder.item(&item);
    }
    let bg_submenu = bg_builder.build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&bg_submenu)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, ev: MenuEvent) {
    let id = ev.id().as_ref().to_string();
    if id == "cc_quit" {
        crate::log_line!("[code-cave] cc_quit menu -> emit app:quit-requested");
        let _ = app.emit("app:quit-requested", ());
        return;
    }
    let Some(theme) = theme_for_menu_id(&id) else { return };

    if let Some(menu) = app.menu() {
        let items = menu.items().unwrap_or_default();
        sync_bg_checks(&items, &id);
    }

    let db = app.state::<Db>();
    let _ = db::app_state::set(&db, BG_THEME_KEY, theme);

    let _ = app.emit("bg-theme-changed", theme);
}

fn sync_bg_checks<R: Runtime>(items: &[MenuItemKind<R>], clicked_id: &str) {
    for item in items {
        match item {
            MenuItemKind::Check(c) => {
                let cid = c.id().as_ref();
                if cid.starts_with("bg_") {
                    let _ = c.set_checked(cid == clicked_id);
                }
            }
            MenuItemKind::Submenu(s) => {
                let sub_items = s.items().unwrap_or_default();
                sync_bg_checks(&sub_items, clicked_id);
            }
            _ => {}
        }
    }
}
