use crate::db::{self, canvases::Canvas, Db};
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub fn canvas_list(db: State<Db>) -> AppResult<Vec<Canvas>> {
    db::canvases::list(&db)
}

#[tauri::command]
pub fn canvas_create(db: State<Db>, name: String) -> AppResult<Canvas> {
    db::canvases::create(&db, &name)
}

#[tauri::command]
pub fn canvas_update_viewport(
    db: State<Db>,
    id: String,
    x: f64,
    y: f64,
    zoom: f64,
) -> AppResult<()> {
    db::canvases::update_viewport(&db, &id, x, y, zoom)
}

#[tauri::command]
pub fn canvas_rename(db: State<Db>, id: String, name: String) -> AppResult<()> {
    db::canvases::rename(&db, &id, &name)
}

#[tauri::command]
pub fn canvas_delete(db: State<Db>, id: String) -> AppResult<()> {
    db::canvases::delete(&db, &id)
}

#[tauri::command]
pub fn canvas_reorder(db: State<Db>, ids: Vec<String>) -> AppResult<()> {
    db::canvases::reorder(&db, &ids)
}
