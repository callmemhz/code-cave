mod agents;
mod commands;
mod db;
mod error;
mod events;
mod menu;
mod pty;
mod tray;

use commands::canvases::*;
use commands::nodes::*;
use db::Db;
use tauri::Manager;

/// When launched from Finder/Applications the inherited PATH is the bare
/// `/usr/bin:/bin:/usr/sbin:/sbin`, so user-installed tools (brew, cargo,
/// bun, node, claude, codex, starship, …) are unreachable from PTY shells
/// and from agent spawns. Capture the user's login+interactive shell PATH
/// once at startup and apply it to our own process so every child inherits.
fn fixup_user_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-i", "-c", "echo $PATH"])
        .output()
    else { return };
    if !output.status.success() { return }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Login/interactive shells may print greetings/MOTD before our echo.
    // Pick the last non-empty line that looks like a PATH.
    let path = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty() && l.contains('/'));
    if let Some(p) = path {
        std::env::set_var("PATH", p);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").try_init().ok();
    fixup_user_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("code-cave.sqlite");
            let db = Db::open(&db_path).expect("open db");
            if db::canvases::list(&db).expect("list canvases").is_empty() {
                db::canvases::create(&db, "default").expect("seed canvas");
            }
            app.manage(db);

            let sup = pty::PtySupervisor::new();
            app.manage(sup);

            // Background scrollback flusher: every 1s, persist live snapshots.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let app = handle;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    let Some(sup) = app.try_state::<pty::PtySupervisor>() else { continue };
                    let Some(db) = app.try_state::<db::Db>() else { continue };
                    for (nid, snap) in sup.collect_snapshots() {
                        let _ = db::scrollback::write(&db, &nid, &snap);
                    }
                }
            });

            tray::install(app.handle())?;
            menu::install(app.handle())?;

            Ok(())
        })
        .on_menu_event(|app, ev| menu::handle_menu_event(app, ev))
        .invoke_handler(tauri::generate_handler![
            canvas_list,
            canvas_create,
            canvas_update_viewport,
            canvas_rename,
            canvas_delete,
            commands::canvases::canvas_reorder,
            node_list,
            node_create,
            node_update_position,
            node_update_size,
            node_update_data,
            node_update_title,
            node_delete,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_snapshot,
            commands::pty::pty_is_alive,
            commands::agents::agent_spawn,
            commands::app_state::app_state_get,
            commands::app_state::app_state_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
