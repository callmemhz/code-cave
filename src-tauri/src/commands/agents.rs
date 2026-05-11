use crate::agents::{build_claude, build_codex, sniff_session_id};
use crate::db::{self, Db};
use crate::error::AppResult;
use crate::pty::PtySupervisor;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Deserialize)]
pub enum AgentKind {
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "codex")]
    Codex,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn agent_spawn(
    app: AppHandle,
    sup: State<PtySupervisor>,
    db: State<Db>,
    node_id: String,
    kind: AgentKind,
    cwd: String,
    extra_args: Vec<String>,
    resume_id: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let launch = match kind {
        AgentKind::Claude => build_claude(resume_id.as_deref(), &extra_args),
        AgentKind::Codex  => build_codex(resume_id.as_deref(), &extra_args),
    };

    let initial = db::scrollback::read(&db, &node_id)?;
    let node_id_for_cb = node_id.clone();
    let app_for_cb = app.clone();

    let on_sniff: Box<dyn Fn(String) + Send + Sync> = Box::new(move |id| {
        if let Some(db) = app_for_cb.try_state::<Db>() {
            let rows: Result<String, _> = {
                let conn = db.conn.lock().unwrap();
                conn.query_row(
                    "SELECT data_json FROM nodes WHERE id=?",
                    [&node_id_for_cb], |r| r.get::<_, String>(0),
                )
            };
            if let Ok(json_str) = rows {
                let mut v: serde_json::Value = serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
                if let Some(map) = v.as_object_mut() {
                    map.insert("resume_session_id".into(), serde_json::Value::String(id.clone()));
                }
                let new_json = serde_json::to_string(&v).unwrap_or(json_str);
                let _ = db::nodes::update_data(&db, &node_id_for_cb, &new_json);
                let _ = app_for_cb.emit(&format!("agent:session:{node_id_for_cb}"), id);
            }
        }
    });

    sup.spawn(
        app, node_id, &cwd, &launch.program, &launch.args, &env, cols, rows,
        initial,
        Some(Box::new(|buf| sniff_session_id(buf))),
        Some(on_sniff),
    )?;
    Ok(())
}
