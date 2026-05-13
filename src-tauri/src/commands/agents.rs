use crate::agents::{build_claude, build_codex, sniff_session_id};
use crate::db::{self, Db};
use crate::error::AppResult;
use crate::pty::PtySupervisor;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Deserialize, Clone, Copy)]
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
        AgentKind::Codex => build_codex(resume_id.as_deref(), &extra_args),
    };
    crate::log_line!(
        "[code-cave] agent_spawn node={} cwd={} program={} args={:?} resume_id={:?}",
        node_id, cwd, launch.program, launch.args, resume_id
    );

    let initial = db::scrollback::read(&db, &node_id)?;
    let app_for_cb = app.clone();
    let node_id_for_cb = node_id.clone();

    let on_sniff: Box<dyn Fn(String) + Send + Sync> = Box::new(move |id| {
        update_resume_session_id(&app_for_cb, &node_id_for_cb, &id);
    });

    sup.spawn(
        app.clone(),
        node_id.clone(),
        &cwd,
        &launch.program,
        &launch.args,
        &env,
        cols,
        rows,
        initial,
        Some(Box::new(|buf| sniff_session_id(buf))),
        Some(on_sniff),
    )?;

    // Authoritative tracking for Claude: poll the filesystem so /resume
    // mid-session is picked up reliably (the sniffer only sees output and
    // misses session swaps that don't print the new id prominently).
    if matches!(kind, AgentKind::Claude) {
        start_claude_session_poller(app, node_id, cwd);
    }

    Ok(())
}

/// Update node.data_json's `resume_session_id` and notify the renderer.
/// No-op if the stored value already matches `new_id`.
pub(crate) fn update_resume_session_id(app: &AppHandle, node_id: &str, new_id: &str) {
    let Some(db) = app.try_state::<Db>() else { return };
    let current: Result<String, _> = {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT data_json FROM nodes WHERE id=?",
            [node_id],
            |r| r.get::<_, String>(0),
        )
    };
    let Ok(json_str) = current else { return };
    let mut v: serde_json::Value =
        serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
    if v.get("resume_session_id").and_then(|x| x.as_str()) == Some(new_id) {
        return; // already up to date
    }
    if let Some(map) = v.as_object_mut() {
        map.insert(
            "resume_session_id".into(),
            serde_json::Value::String(new_id.to_string()),
        );
    }
    let new_json = serde_json::to_string(&v).unwrap_or(json_str);
    let _ = db::nodes::update_data(&db, node_id, &new_json);
    let _ = app.emit(&format!("agent:session:{node_id}"), new_id.to_string());
}

/// Set node.data_json's `resume_session_id` to null and notify the renderer
/// (empty string payload). Used when the claude PID changes (Ctrl+C +
/// relaunch in the same pane) so the title doesn't keep showing the dead
/// session's id until the user types into the new one.
pub(crate) fn clear_resume_session_id(app: &AppHandle, node_id: &str) {
    let Some(db) = app.try_state::<Db>() else { return };
    let current: Result<String, _> = {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT data_json FROM nodes WHERE id=?",
            [node_id],
            |r| r.get::<_, String>(0),
        )
    };
    let Ok(json_str) = current else { return };
    let mut v: serde_json::Value =
        serde_json::from_str(&json_str).unwrap_or(serde_json::json!({}));
    if v.get("resume_session_id").map_or(true, |x| x.is_null()) {
        return;
    }
    if let Some(map) = v.as_object_mut() {
        map.insert("resume_session_id".into(), serde_json::Value::Null);
    }
    let new_json = serde_json::to_string(&v).unwrap_or(json_str);
    let _ = db::nodes::update_data(&db, node_id, &new_json);
    let _ = app.emit(&format!("agent:session:{node_id}"), String::new());
}

pub(crate) fn encode_claude_project_dir(cwd: &str) -> PathBuf {
    let expanded = if let Some(rest) = cwd.strip_prefix("~") {
        match dirs::home_dir() {
            Some(home) => format!("{}{}", home.display(), rest),
            None => cwd.to_string(),
        }
    } else {
        cwd.to_string()
    };
    // Claude encodes the cwd by replacing every "/" with "-" (the leading
    // slash becomes a leading dash). Verified by inspection of
    // ~/.claude/projects/.
    let dashed = expanded.replace('/', "-");
    let mut p = dirs::home_dir().unwrap_or_default();
    p.push(".claude");
    p.push("projects");
    p.push(dashed);
    p
}

pub(crate) fn is_uuid_like(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    s.chars().enumerate().all(|(i, c)| {
        if matches!(i, 8 | 13 | 18 | 23) {
            c == '-'
        } else {
            c.is_ascii_hexdigit()
        }
    })
}

pub(crate) fn find_latest_session_id(dir: &Path) -> Option<String> {
    find_latest_session_id_after(dir, None)
}

/// If `since` is `Some`, only consider files whose mtime is strictly newer
/// than that instant. Used to ignore .jsonl files that existed before a
/// terminal pane was launched.
pub(crate) fn find_latest_session_id_after(
    dir: &Path,
    since: Option<std::time::SystemTime>,
) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else { continue };
        if ext != "jsonl" {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        if !is_uuid_like(stem) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };
        if let Some(since) = since {
            if mtime <= since {
                continue;
            }
        }
        if best.as_ref().map_or(true, |(t, _)| mtime > *t) {
            best = Some((mtime, stem.to_string()));
        }
    }
    best.map(|(_, id)| id)
}

fn start_claude_session_poller(app: AppHandle, node_id: String, cwd: String) {
    std::thread::spawn(move || {
        let project_dir = encode_claude_project_dir(&cwd);
        let mut last_seen: Option<String> = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let Some(sup) = app.try_state::<PtySupervisor>() else { break };
            let alive = sup
                .get(&node_id)
                .map(|s| s.is_alive())
                .unwrap_or(false);
            if !alive {
                break;
            }
            let Some(latest) = find_latest_session_id(&project_dir) else { continue };
            if Some(latest.as_str()) == last_seen.as_deref() {
                continue;
            }
            last_seen = Some(latest.clone());
            update_resume_session_id(&app, &node_id, &latest);
        }
    });
}
