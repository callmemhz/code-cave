use crate::commands::agents::{
    clear_resume_session_id, encode_claude_project_dir, find_latest_session_id,
    find_latest_session_id_after, is_uuid_like, update_resume_session_id,
};
use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use crate::pty::PtySupervisor;
use base64::Engine;
use std::collections::HashMap;
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

/// Watches the canonical claude project dir for this terminal's cwd. If a
/// new `<uuid>.jsonl` file appears AFTER the terminal was spawned, we
/// assume the user invoked claude and convert the node's type in place.
/// After promotion, also checks whether `claude` is still actually running
/// under this PTY; if not (e.g. user hit Ctrl-C), demote back to terminal.
fn start_terminal_to_claude_watcher(app: AppHandle, node_id: String, cwd: String) {
    std::thread::spawn(move || {
        let mut tracked_cwd = cwd.clone();
        let mut started_at = SystemTime::now() - Duration::from_secs(2); // grace
        let mut promoted = false;
        let mut last_seen: Option<String> = None;
        let mut last_claude_pid: Option<u32> = None;
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
            let claude_info = pty_pid.and_then(find_claude_process_under);
            let claude_alive = claude_info.is_some();
            let claude_pid = claude_info.as_ref().map(|(p, _)| *p);
            // Detect "new claude in same pane" (Ctrl+C then re-launch).
            // Without this, the stale jsonl from the previous session is
            // still the latest in project_dir, so last_seen never advances
            // until the user types into the new claude.
            if promoted && claude_pid.is_some() && last_claude_pid != claude_pid {
                if last_claude_pid.is_some() {
                    last_seen = None;
                    clear_resume_session_id(&app, &node_id);
                }
                last_claude_pid = claude_pid;
            } else if claude_pid.is_none() {
                last_claude_pid = None;
            }
            crate::log_line!(
                "[code-cave] watcher node={} pty_pid={:?} claude_alive={} promoted={}",
                node_id, pty_pid, claude_alive, promoted,
            );
            if !claude_alive && !promoted {
                if let Ok(o) = std::process::Command::new("sh").arg("-c")
                    .arg("ps -axo pid,ppid,command | grep -i claude | grep -v grep | head -5")
                    .output()
                {
                    let s = String::from_utf8_lossy(&o.stdout);
                    if !s.trim().is_empty() {
                        crate::log_line!("[code-cave] ps claude-like:\n{}", s);
                    }
                }
            }

            // Try to find the session claude is currently writing.
            // 1) lsof claude's open files (works only if claude keeps
            //    the .jsonl open; in practice it closes after writes)
            // 2) Fallback: scan ALL of ~/.claude/projects/ for a .jsonl
            //    freshly modified after this pane started
            let active_session = claude_info
                .as_ref()
                .and_then(|(pid, _)| find_claude_active_session(*pid))
                .or_else(|| {
                    if claude_alive {
                        find_recent_session_globally(started_at)
                    } else {
                        None
                    }
                });

            // cwd tracking has DIFFERENT rules based on mode:
            //   - Terminal mode (claude not running): follow shell's
            //     cwd via lsof so `cd` survives restart.
            //   - Claude mode (running): only update cwd when an
            //     active_session is found (it gives us the PROJECT
            //     root by decoding the .jsonl's parent dir). NEVER
            //     fall back to claude's runtime cwd — `claude -w foo`
            //     runs in the worktree, but sessions live in the main
            //     project dir, and using the worktree cwd would break
            //     `claude --resume` on the next launch.
            if claude_alive {
                if let Some((session_cwd, _)) = &active_session {
                    if session_cwd != &tracked_cwd {
                        tracked_cwd = session_cwd.clone();
                        update_node_cwd_if_changed(&app, &node_id, session_cwd);
                    }
                }
            } else if let Some(pid) = pty_pid {
                if let Some(new_cwd) = get_process_cwd(pid) {
                    if new_cwd != tracked_cwd {
                        tracked_cwd = new_cwd.clone();
                        update_node_cwd_if_changed(&app, &node_id, &new_cwd);
                    }
                }
            }

            // project_dir derives from the live tracked cwd so worktree-mode
            // sessions land in the right ~/.claude/projects/<encoded> dir.
            let project_dir = encode_claude_project_dir(&tracked_cwd);

            if !promoted {
                let session_id = find_latest_session_id_after(&project_dir, Some(started_at));
                if claude_alive || session_id.is_some() {
                    let id_ref = session_id.as_deref();
                    let args_ref = claude_info.as_ref().map(|(_, a)| a.as_slice()).unwrap_or(&[]);
                    if promote_terminal_to_claude(&app, &node_id, &tracked_cwd, id_ref, args_ref) {
                        promoted = true;
                        last_seen = session_id;
                        dead_ticks = 0;
                    }
                }
            } else {
                // Prefer lsof on claude's open files — it's authoritative
                // even when the user did /resume to a session in a
                // different project dir than our cwd-scoped FS scan watches.
                let active_id = active_session
                    .as_ref()
                    .map(|(_, id)| id.clone())
                    .or_else(|| find_latest_session_id(&project_dir));
                if let Some(id) = active_id {
                    if last_seen.as_deref() != Some(id.as_str()) {
                        last_seen = Some(id.clone());
                        update_resume_session_id(&app, &node_id, &id);
                    }
                }
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
/// config in data_json._original_terminal so we can demote later. The
/// `captured_args` are the running claude's argv (sans program name);
/// we keep `-w <worktree>` verbatim so respawn re-enters the worktree.
/// `cwd` should be the PROJECT ROOT (where claude --resume looks for
/// the session file), not the worktree path — see
/// [`find_claude_active_session`].
/// Returns true on success.
fn promote_terminal_to_claude(
    app: &AppHandle,
    node_id: &str,
    cwd: &str,
    session_id: Option<&str>,
    captured_args: &[String],
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
        "args": captured_args,
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

/// Find a `claude` process running on the same controlling terminal as
/// `root_pid`. PTY-based "is this in the same pane" — more robust than
/// walking ppid chains, which break when claude or a wrapper does an
/// extra fork/exec that re-parents the process.
fn find_claude_process_under(root_pid: u32) -> Option<(u32, Vec<String>)> {
    // 1. Ask ps for our shell's controlling terminal (e.g. "ttys012").
    let tty_out = std::process::Command::new("ps")
        .args(["-p", &root_pid.to_string(), "-o", "tty="])
        .output()
        .ok()?;
    let shell_tty = String::from_utf8_lossy(&tty_out.stdout).trim().to_string();
    if shell_tty.is_empty() || shell_tty == "??" || shell_tty == "?" {
        return None; // no controlling tty → can't match
    }

    // 2. Walk all processes on that tty, find a claude command.
    let all = std::process::Command::new("ps")
        .args(["-axo", "pid=,tty=,command="])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&all.stdout);
    for line in s.lines() {
        let trimmed = line.trim_start();
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        let Some(pid_s) = parts.next() else { continue };
        let Some(tty) = parts.next() else { continue };
        let cmd = parts.next().unwrap_or("").trim_start();
        if tty != shell_tty {
            continue;
        }
        if !is_claude_cmd(cmd) {
            continue;
        }
        let Ok(pid) = pid_s.parse::<u32>() else { continue };
        // Skip the program name, keep the rest as argv.
        let mut tokens = cmd.split_whitespace();
        tokens.next();
        return Some((pid, tokens.map(String::from).collect()));
    }
    None
}

/// Inspect a running claude process's open `~/.claude/projects/*/<uuid>.jsonl`.
/// Returns `(project_cwd, session_id)` where `project_cwd` is the decoded
/// real path of the project directory (which is where claude expects to
/// be cd'd to for `--resume` to find the session).
///
/// Why both pieces, why not just the cwd from `get_process_cwd` on claude:
/// claude's `-w <worktree>` mode runs claude IN the worktree but stores
/// the session under the MAIN project root's project dir. lsof on the
/// open file is the only signal that tells us where the session actually
/// lives.
fn find_claude_active_session(pid: u32) -> Option<(String, String)> {
    let output = std::process::Command::new("lsof")
        .args(["-p", &pid.to_string(), "-F", "n"])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&output.stdout);
    for line in s.lines() {
        let Some(path_str) = line.strip_prefix('n') else { continue };
        if !path_str.contains("/.claude/projects/") || !path_str.ends_with(".jsonl") {
            continue;
        }
        let p = std::path::Path::new(path_str);
        let stem = p.file_stem().and_then(|s| s.to_str())?;
        if !is_uuid_like(stem) {
            continue;
        }
        if let Some(cwd) = read_session_cwd(p) {
            return Some((cwd, stem.to_string()));
        }
    }
    None
}

/// Read the session's original cwd out of the .jsonl file itself. Claude
/// writes the cwd into every event object; the dir-name encoding is lossy
/// (both `/` and `.` map to `-`) so parsing the file is way more reliable
/// than trying to reverse the encoding.
fn read_session_cwd(jsonl_path: &std::path::Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let f = std::fs::File::open(jsonl_path).ok()?;
    let reader = BufReader::new(f);
    for (i, line) in reader.lines().enumerate() {
        if i >= 30 { return None }
        let Ok(line) = line else { continue };
        let Ok(v): Result<serde_json::Value, _> = serde_json::from_str(&line) else { continue };
        if let Some(cwd) = v.get("cwd").and_then(|x| x.as_str()) {
            return Some(cwd.to_string());
        }
    }
    None
}

/// Scan all `~/.claude/projects/*/<uuid>.jsonl` files and return
/// `(cwd, session_id)` for the most-recently-modified one that's newer
/// than `since`. This is the fallback when lsof can't find an open
/// `.jsonl` — claude appears to write-then-close rather than keep its
/// session file held open.
fn find_recent_session_globally(since: SystemTime) -> Option<(String, String)> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");
    let entries = std::fs::read_dir(&projects_dir).ok()?;
    let mut best: Option<(SystemTime, std::path::PathBuf, String)> = None;
    for entry in entries.flatten() {
        let project_path = entry.path();
        if !project_path.is_dir() { continue }
        let Ok(inner) = std::fs::read_dir(&project_path) else { continue };
        for f in inner.flatten() {
            let path = f.path();
            let Some(ext) = path.extension().and_then(|s| s.to_str()) else { continue };
            if ext != "jsonl" { continue }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            if !is_uuid_like(stem) { continue }
            let Ok(meta) = f.metadata() else { continue };
            let Ok(mtime) = meta.modified() else { continue };
            if mtime <= since { continue }
            if best.as_ref().map_or(true, |(t, _, _)| mtime > *t) {
                best = Some((mtime, path.clone(), stem.to_string()));
            }
        }
    }
    let (_, path, id) = best?;
    let cwd = read_session_cwd(&path)?;
    Some((cwd, id))
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
    // Any token in the command line:
    //   - whose basename is literally "claude" (covers `claude foo`,
    //     `/usr/local/bin/claude foo`)
    //   - or that points into a claude-code installation (covers
    //     `node /.../@anthropic-ai/claude-code/cli.js foo` when the
    //     shebang exec re-spawned through node)
    cmd.split_whitespace().any(|tok| {
        let base = std::path::Path::new(tok)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(tok);
        base == "claude"
            || tok.contains("@anthropic-ai/claude")
            || tok.contains("/claude-code/")
    })
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
