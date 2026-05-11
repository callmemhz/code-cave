use crate::db::{self, Db};
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub fn app_state_get(db: State<Db>, key: String) -> AppResult<Option<String>> {
    db::app_state::get(&db, &key)
}

#[tauri::command]
pub fn app_state_set(db: State<Db>, key: String, value: String) -> AppResult<()> {
    db::app_state::set(&db, &key, &value)
}
