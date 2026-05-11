use crate::db::{
    self,
    nodes::{NewNode, Node},
    Db,
};
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub fn node_list(db: State<Db>, canvas_id: String) -> AppResult<Vec<Node>> {
    db::nodes::list_by_canvas(&db, &canvas_id)
}

#[tauri::command]
pub fn node_create(db: State<Db>, input: NewNode) -> AppResult<Node> {
    db::nodes::create(&db, input)
}

#[tauri::command]
pub fn node_update_position(db: State<Db>, id: String, x: f64, y: f64) -> AppResult<()> {
    db::nodes::update_position(&db, &id, x, y)
}

#[tauri::command]
pub fn node_update_size(db: State<Db>, id: String, width: f64, height: f64) -> AppResult<()> {
    db::nodes::update_size(&db, &id, width, height)
}

#[tauri::command]
pub fn node_update_data(db: State<Db>, id: String, data_json: String) -> AppResult<()> {
    db::nodes::update_data(&db, &id, &data_json)
}

#[tauri::command]
pub fn node_update_title(db: State<Db>, id: String, title: Option<String>) -> AppResult<()> {
    db::nodes::update_title(&db, &id, title.as_deref())
}

#[tauri::command]
pub fn node_delete(db: State<Db>, id: String) -> AppResult<()> {
    db::nodes::delete(&db, &id)
}
