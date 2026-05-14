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
        // Pass extra_args so the poller knows about `-w <name>` worktree mode
        // and looks in the right ~/.claude/projects/<encoded>/ dir.
        start_claude_session_poller(app, node_id, cwd, extra_args);
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
    // Claude encodes the cwd by replacing every "/" AND every "." with "-"
    // (the leading slash becomes a leading dash). So
    // /Users/.../code-cave/.claude/worktrees/hinter becomes
    // -Users-...-code-cave--claude-worktrees-hinter (note the double dash
    // where ".claude" used to be). Verified by inspection of
    // ~/.claude/projects/.
    let dashed: String = expanded
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect();
    let mut p = dirs::home_dir().unwrap_or_default();
    p.push(".claude");
    p.push("projects");
    p.push(dashed);
    p
}

/// Find the worktree name in a claude argv, if `-w <name>` / `--worktree <name>`
/// is present. The name may be a bare worktree shortcut (e.g. "hinter") or
/// an absolute path.
pub(crate) fn parse_worktree_arg(args: &[String]) -> Option<&str> {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "-w" || a == "--worktree" {
            return iter.next().map(String::as_str);
        }
    }
    None
}

/// Where ~/.claude/projects/<encoded>/ actually lives for a (cwd, args) pair.
///
/// For `claude -w <name>` mode, the session is stored under the WORKTREE's
/// encoded absolute path (`<cwd>/.claude/worktrees/<name>`), not the launch
/// cwd. For non-worktree panes, it's just `encode(cwd)`.
pub(crate) fn resolve_session_storage_dir(cwd: &str, args: &[String]) -> PathBuf {
    let Some(name) = parse_worktree_arg(args) else {
        return encode_claude_project_dir(cwd);
    };
    let worktree_path = if Path::new(name).is_absolute() {
        name.to_string()
    } else {
        let base = if let Some(rest) = cwd.strip_prefix("~") {
            match dirs::home_dir() {
                Some(home) => format!("{}{}", home.display(), rest),
                None => cwd.to_string(),
            }
        } else {
            cwd.to_string()
        };
        format!("{}/.claude/worktrees/{}", base.trim_end_matches('/'), name)
    };
    encode_claude_project_dir(&worktree_path)
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

/// One-shot startup repair: legacy panes with `-w <name>` may have a
/// `resume_session_id` that points to a session in the MAIN project's encoded
/// dir (a stale id stolen from another pane), because earlier versions of the
/// watcher used encode(cwd) instead of encode(worktree-abs-path) for `-w`
/// mode. For each affected pane, point `resume_session_id` at the latest
/// session that actually exists under the worktree's storage dir, or null it
/// if there's nothing valid there. Without this, the first respawn after
/// upgrading runs `claude --resume <stale-id>` and prints "conversation not
/// found".
pub fn repair_worktree_resume_ids(db: &Db) {
    let rows: Vec<(String, String)> = {
        let conn = db.conn.lock().unwrap();
        let Ok(mut stmt) = conn.prepare("SELECT id, data_json FROM nodes WHERE type='claude'")
        else { return };
        stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map(|it| it.filter_map(Result::ok).collect())
            .unwrap_or_default()
    };
    for (id, data_json) in rows {
        let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&data_json) else { continue };
        let cwd = v.get("cwd").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let args: Vec<String> = v
            .get("args")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if parse_worktree_arg(&args).is_none() {
            continue;
        }
        let storage_dir = resolve_session_storage_dir(&cwd, &args);
        let current = v.get("resume_session_id").and_then(|x| x.as_str()).map(String::from);
        let already_valid = current
            .as_ref()
            .map(|sid| storage_dir.join(format!("{sid}.jsonl")).exists())
            .unwrap_or(false);
        if already_valid {
            continue;
        }
        let new_id = find_latest_session_id(&storage_dir);
        if let Some(map) = v.as_object_mut() {
            map.insert(
                "resume_session_id".into(),
                match &new_id {
                    Some(s) => serde_json::Value::String(s.clone()),
                    None => serde_json::Value::Null,
                },
            );
        }
        let new_json = serde_json::to_string(&v).unwrap_or(data_json);
        let _ = db::nodes::update_data(db, &id, &new_json);
        crate::log_line!(
            "[code-cave] repair worktree node {} resume_id {:?} -> {:?}",
            id, current, new_id
        );
    }
}

fn start_claude_session_poller(
    app: AppHandle,
    node_id: String,
    cwd: String,
    args: Vec<String>,
) {
    std::thread::spawn(move || {
        let project_dir = resolve_session_storage_dir(&cwd, &args);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_replaces_slash_and_dot() {
        // Matches what claude actually writes under ~/.claude/projects/.
        let p = encode_claude_project_dir("/Users/me/src/foo/.claude/worktrees/bar");
        assert!(p.ends_with("-Users-me-src-foo--claude-worktrees-bar"), "got {}", p.display());
    }

    #[test]
    fn parse_worktree_arg_handles_short_and_long() {
        let a: Vec<String> = ["--dangerously-skip-permissions", "-w", "hinter", "-c"]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(parse_worktree_arg(&a), Some("hinter"));
        let b: Vec<String> = ["--worktree", "feat-x"].iter().map(|s| s.to_string()).collect();
        assert_eq!(parse_worktree_arg(&b), Some("feat-x"));
        let c: Vec<String> = ["--dangerously-skip-permissions"].iter().map(|s| s.to_string()).collect();
        assert_eq!(parse_worktree_arg(&c), None);
    }

    #[test]
    fn resolve_storage_dir_worktree_mode() {
        let args: Vec<String> = ["-w", "hinter"].iter().map(|s| s.to_string()).collect();
        let p = resolve_session_storage_dir("/Users/me/src/code-cave", &args);
        assert!(p.ends_with("-Users-me-src-code-cave--claude-worktrees-hinter"), "got {}", p.display());
    }

    #[test]
    fn resolve_storage_dir_plain_mode() {
        let p = resolve_session_storage_dir("/Users/me/src/code-cave", &[]);
        assert!(p.ends_with("-Users-me-src-code-cave"), "got {}", p.display());
    }

    #[test]
    fn resolve_storage_dir_absolute_worktree_arg() {
        let args: Vec<String> = ["-w", "/abs/path/to/wt"].iter().map(|s| s.to_string()).collect();
        let p = resolve_session_storage_dir("/Users/me/src/foo", &args);
        assert!(p.ends_with("-abs-path-to-wt"), "got {}", p.display());
    }
}
