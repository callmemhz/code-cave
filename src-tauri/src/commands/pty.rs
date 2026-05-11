use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use crate::pty::PtySupervisor;
use base64::Engine;
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    sup: State<PtySupervisor>,
    db: State<Db>,
    node_id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> AppResult<String> {
    let initial = db::scrollback::read(&db, &node_id)?;
    let _ = sup.spawn(app, node_id.clone(), &cwd, &program, &args, &env, cols, rows, initial, None, None)?;
    Ok(node_id)
}

#[tauri::command]
pub fn pty_write(sup: State<PtySupervisor>, node_id: String, bytes_b64: String) -> AppResult<()> {
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine.decode(bytes_b64.as_bytes())
        .map_err(|e| AppError::Invalid(format!("b64: {e}")))?;
    let s = sup.get(&node_id).ok_or_else(|| AppError::NotFound(node_id.clone()))?;
    s.write(&bytes)
}

#[tauri::command]
pub fn pty_resize(sup: State<PtySupervisor>, node_id: String, cols: u16, rows: u16) -> AppResult<()> {
    let s = sup.get(&node_id).ok_or_else(|| AppError::NotFound(node_id.clone()))?;
    s.resize(cols, rows)
}

#[tauri::command]
pub fn pty_kill(sup: State<PtySupervisor>, node_id: String) -> AppResult<()> {
    sup.kill(&node_id)
}

#[tauri::command]
pub fn pty_snapshot(
    sup: State<PtySupervisor>,
    db: State<Db>,
    node_id: String,
) -> AppResult<String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = sup.snapshot(&node_id)
        .unwrap_or_else(|| db::scrollback::read(&db, &node_id).unwrap_or_default());
    Ok(engine.encode(&bytes))
}

#[tauri::command]
pub fn pty_is_alive(sup: State<PtySupervisor>, node_id: String) -> bool {
    sup.get(&node_id).map(|s| s.is_alive()).unwrap_or(false)
}
