mod commands;
mod db;
mod error;
mod events;
mod pty;

use commands::canvases::*;
use commands::nodes::*;
use db::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("code-cave.sqlite");
            let db = Db::open(&db_path).expect("open db");
            if db::canvases::list(&db).expect("list canvases").is_empty() {
                db::canvases::create(&db, "default").expect("seed canvas");
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            canvas_list,
            canvas_create,
            canvas_update_viewport,
            canvas_rename,
            canvas_delete,
            node_list,
            node_create,
            node_update_position,
            node_update_size,
            node_update_data,
            node_update_title,
            node_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
