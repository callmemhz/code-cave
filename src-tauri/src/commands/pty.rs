use crate::commands::agents::{
    encode_claude_project_dir, find_latest_session_id, find_latest_session_id_after,
    update_resume_session_id,
};
use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use crate::pty::PtySupervisor;
use base64::Engine;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

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

    // Per-pane shell init: gives this pane its own HISTFILE and forces
    // INC_APPEND_HISTORY so commands persist immediately (no need for
    // the shell to exit cleanly). For zsh we use ZDOTDIR; for other
    // shells we just skip and fall back to the user's defaults.
    let mut env = env;
    if is_zsh_program(&program) {
        if let Some(zdir) = prepare_pane_zdotdir(&app, &node_id) {
            env.insert("ZDOTDIR".to_string(), zdir.display().to_string());
        }
    }

    let _ = sup.spawn(
        app.clone(),
        node_id.clone(),
        &cwd,
        &program,
        &args,
        &env,
        cols,
        rows,
        initial,
        None,
        None,
    )?;
    // Watch this terminal: if the user runs `claude` in it, promote the
    // node to a claude pane automatically.
    start_terminal_to_claude_watcher(app, node_id.clone(), cwd);
    Ok(node_id)
}

fn is_zsh_program(program: &str) -> bool {
    Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|n| n == "zsh" || n.ends_with("zsh"))
        .unwrap_or(false)
}

/// Create (idempotently) a private ZDOTDIR for this pane containing a
/// `.zshrc` that:
///   - sources the user's real ~/.zshrc (so themes / aliases / prompts
///     still apply),
///   - overrides HISTFILE to a per-pane file under the app data dir,
///   - enables INC_APPEND_HISTORY + SHARE_HISTORY so commands persist
///     immediately rather than only on clean shell exit.
///
/// The `.zshenv` is also templated through so user-level env vars apply.
/// We don't bother with `.zprofile` / `.zlogin` — login mode isn't used.
fn prepare_pane_zdotdir(app: &AppHandle, node_id: &str) -> Option<PathBuf> {
    let data = app.path().app_data_dir().ok()?;
    let zdir = data.join("zsh-init").join(node_id);
    std::fs::create_dir_all(&zdir).ok()?;
    let histdir = data.join("zsh-history");
    std::fs::create_dir_all(&histdir).ok()?;
    let histfile = histdir.join(node_id);

    // .zshenv first so user-level env (PATH augmentations etc.) still load.
    let zshenv = "if [ -f \"$HOME/.zshenv\" ]; then\n  emulate sh -c 'source \"$HOME/.zshenv\"'\nfi\n";
    let _ = std::fs::write(zdir.join(".zshenv"), zshenv);

    // .zshrc: source user's first so our overrides win.
    let zshrc = format!(
        "# code-cave per-pane init — auto-generated, do not edit by hand.\n\
if [ -f \"$HOME/.zshrc\" ]; then\n  source \"$HOME/.zshrc\"\nfi\n\
HISTFILE={histfile}\n\
HISTSIZE=10000\n\
SAVEHIST=10000\n\
setopt INC_APPEND_HISTORY SHARE_HISTORY HIST_IGNORE_DUPS HIST_IGNORE_ALL_DUPS HIST_FIND_NO_DUPS\n",
        histfile = shell_single_quote(&histfile.display().to_string()),
    );
    let _ = std::fs::write(zdir.join(".zshrc"), zshrc);

    Some(zdir)
}

/// Wrap a value in zsh-safe single quotes (escape embedded quotes).
fn shell_single_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Watches the canonical claude project dir for this terminal's cwd. If a
/// new `<uuid>.jsonl` file appears AFTER the terminal was spawned, we
/// assume the user invoked claude and convert the node's type in place.
/// After promotion, also checks whether `claude` is still actually running
/// under this PTY; if not (e.g. user hit Ctrl-C), demote back to terminal.
fn start_terminal_to_claude_watcher(app: AppHandle, node_id: String, cwd: String) {
    std::thread::spawn(move || {
        let project_dir = encode_claude_project_dir(&cwd);
        let mut started_at = SystemTime::now() - Duration::from_secs(2); // grace
        let mut promoted = false;
        let mut last_seen: Option<String> = None;
        let mut dead_ticks: u32 = 0;

        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let Some(sup) = app.try_state::<PtySupervisor>() else { break };
            let session = sup.get(&node_id);
            let alive = session.as_ref().map(|s| s.is_alive()).unwrap_or(false);
            if !alive {
                break;
            }
            let pty_pid = session.as_ref().and_then(|s| s.child_pid());
            let claude_alive = pty_pid.map(is_claude_running_under).unwrap_or(false);

            // Track shell cwd so `cd` survives app restart.
            if let Some(pid) = pty_pid {
                if let Some(cwd_now) = get_process_cwd(pid) {
                    update_node_cwd_if_changed(&app, &node_id, &cwd_now);
                }
            }

            if !promoted {
                // Promote on EITHER signal: a claude descendant process, or a
                // fresh session file. The process check fires almost
                // immediately (before claude writes any .jsonl), so the badge
                // turns orange as soon as `claude` starts — not after the
                // first user message.
                let session_id = find_latest_session_id_after(&project_dir, Some(started_at));
                if claude_alive || session_id.is_some() {
                    let id_ref = session_id.as_deref();
                    if promote_terminal_to_claude(&app, &node_id, &cwd, id_ref) {
                        promoted = true;
                        last_seen = session_id;
                        dead_ticks = 0;
                    }
                }
            } else {
                // Update session id if the user did /resume (or it just
                // appeared post-promotion).
                if let Some(id) = find_latest_session_id(&project_dir) {
                    if last_seen.as_deref() != Some(id.as_str()) {
                        last_seen = Some(id.clone());
                        update_resume_session_id(&app, &node_id, &id);
                    }
                }
                // Demote when `claude` exits (Ctrl-C). Require 2 consecutive
                // misses (~3s) to avoid teardown/startup races.
                if !claude_alive {
                    dead_ticks += 1;
                    if dead_ticks >= 2 {
                        if demote_claude_to_terminal(&app, &node_id) {
                            promoted = false;
                            dead_ticks = 0;
                            started_at = SystemTime::now() - Duration::from_secs(2);
                        }
                    }
                } else {
                    dead_ticks = 0;
                }
            }
        }
    });
}

/// DB-promote a terminal node to type='claude' and broadcast the new node
/// so the renderer can swap component types. Embeds the original terminal
/// config in data_json._original_terminal so we can demote later.
/// Returns true on success.
fn promote_terminal_to_claude(
    app: &AppHandle,
    node_id: &str,
    cwd: &str,
    session_id: Option<&str>,
) -> bool {
    let Some(db) = app.try_state::<Db>() else { return false };

    let node = match db::nodes::find(&db, node_id) {
        Ok(Some(n)) => n,
        _ => return false,
    };
    if node.r#type != "terminal" {
        return false;
    }

    // Stash the original terminal config so demote can restore it.
    let old: serde_json::Value =
        serde_json::from_str(&node.data_json).unwrap_or(serde_json::json!({}));
    let shell = old.get("shell").and_then(|v| v.as_str()).unwrap_or("/bin/zsh");
    let env = old.get("env").cloned().unwrap_or(serde_json::json!({}));

    let resume_value = match session_id {
        Some(s) => serde_json::Value::String(s.to_string()),
        None => serde_json::Value::Null,
    };
    let new_data = serde_json::json!({
        "cwd": cwd,
        "args": [],
        "resume_session_id": resume_value,
        "_original_terminal": { "shell": shell, "env": env },
    });
    let new_data_str = match serde_json::to_string(&new_data) {
        Ok(s) => s,
        Err(_) => return false,
    };

    {
        let conn = db.conn.lock().unwrap();
        let ts = now_millis();
        let r = conn.execute(
            "UPDATE nodes SET type='claude', data_json=?, updated_at=? WHERE id=?",
            rusqlite::params![new_data_str, ts, node_id],
        );
        if r.is_err() {
            return false;
        }
    }

    if let Ok(Some(updated)) = db::nodes::find(&db, node_id) {
        let _ = app.emit("node:converted", updated);
    }
    true
}

/// Reverse of promote_terminal_to_claude. Only fires for panes that were
/// auto-promoted (identified by the `_original_terminal` marker).
fn demote_claude_to_terminal(app: &AppHandle, node_id: &str) -> bool {
    let Some(db) = app.try_state::<Db>() else { return false };

    let node = match db::nodes::find(&db, node_id) {
        Ok(Some(n)) => n,
        _ => return false,
    };
    if node.r#type != "claude" {
        return false;
    }

    let data: serde_json::Value =
        serde_json::from_str(&node.data_json).unwrap_or(serde_json::json!({}));
    // Only auto-promoted panes carry the marker. Native claude panes are
    // immune to demotion.
    let Some(original) = data.get("_original_terminal") else { return false };
    let cwd = data.get("cwd").and_then(|v| v.as_str()).unwrap_or("~").to_string();
    let shell = original
        .get("shell")
        .and_then(|v| v.as_str())
        .unwrap_or("/bin/zsh")
        .to_string();
    let env = original.get("env").cloned().unwrap_or(serde_json::json!({}));

    let new_data = serde_json::json!({ "cwd": cwd, "shell": shell, "env": env });
    let new_data_str = match serde_json::to_string(&new_data) {
        Ok(s) => s,
        Err(_) => return false,
    };

    {
        let conn = db.conn.lock().unwrap();
        let ts = now_millis();
        let r = conn.execute(
            "UPDATE nodes SET type='terminal', data_json=?, updated_at=? WHERE id=?",
            rusqlite::params![new_data_str, ts, node_id],
        );
        if r.is_err() {
            return false;
        }
    }

    if let Ok(Some(updated)) = db::nodes::find(&db, node_id) {
        let _ = app.emit("node:converted", updated);
    }
    true
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Walks the process tree via `ps`. Returns true if a `claude` process
/// is anywhere in the descendant chain of `root_pid`.
fn is_claude_running_under(root_pid: u32) -> bool {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output() else { return true };
    let s = String::from_utf8_lossy(&output.stdout);

    let mut ppid_of: std::collections::HashMap<u32, u32> =
        std::collections::HashMap::new();
    let mut claude_pids: Vec<u32> = Vec::new();

    for line in s.lines() {
        let trimmed = line.trim_start();
        // splitn(3, ws) gives [pid, ppid, "rest of line including spaces"]
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        let Some(pid_s) = parts.next() else { continue };
        let Some(ppid_s) = parts.next() else { continue };
        let cmd = parts.next().unwrap_or("").trim_start();
        let Ok(pid) = pid_s.parse::<u32>() else { continue };
        let Ok(ppid) = ppid_s.parse::<u32>() else { continue };
        ppid_of.insert(pid, ppid);
        if is_claude_cmd(cmd) {
            claude_pids.push(pid);
        }
    }

    for claude_pid in claude_pids {
        let mut cur = claude_pid;
        for _ in 0..64 {
            if cur == root_pid { return true }
            let Some(&parent) = ppid_of.get(&cur) else { break };
            if parent <= 1 { break }
            cur = parent;
        }
    }
    false
}

/// Returns the current working directory of `pid` via macOS `lsof`.
fn get_process_cwd(pid: u32) -> Option<String> {
    let output = std::process::Command::new("lsof")
        .args(["-p", &pid.to_string(), "-a", "-d", "cwd", "-F", "n"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix('n') {
            return Some(rest.to_string());
        }
    }
    None
}

/// Update node.data_json's `cwd` if it differs, and broadcast the new node
/// so the subtitle/header reflects the change live. No-op if unchanged.
fn update_node_cwd_if_changed(app: &AppHandle, node_id: &str, new_cwd: &str) {
    let Some(db) = app.try_state::<Db>() else { return };
    let Ok(Some(node)) = db::nodes::find(&db, node_id) else { return };
    let mut data: serde_json::Value =
        serde_json::from_str(&node.data_json).unwrap_or(serde_json::json!({}));
    if data.get("cwd").and_then(|v| v.as_str()) == Some(new_cwd) {
        return;
    }
    if let Some(map) = data.as_object_mut() {
        map.insert("cwd".into(), serde_json::Value::String(new_cwd.to_string()));
    }
    let new_json = serde_json::to_string(&data).unwrap_or(node.data_json.clone());
    let _ = db::nodes::update_data(&db, node_id, &new_json);
    if let Ok(Some(updated)) = db::nodes::find(&db, node_id) {
        let _ = app.emit("node:converted", updated);
    }
}

fn is_claude_cmd(cmd: &str) -> bool {
    let first = cmd.split_whitespace().next().unwrap_or("");
    let base = std::path::Path::new(first)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(first);
    base == "claude"
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
