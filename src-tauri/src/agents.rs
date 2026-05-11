use once_cell::sync::Lazy;
use regex::Regex;

pub struct AgentLaunch {
    pub program: String,
    pub args: Vec<String>,
}

/// Build a launch command for an agent node.
/// `resume_id` is the previously-captured session id, if any.
pub fn build_claude(resume_id: Option<&str>, extra: &[String]) -> AgentLaunch {
    let mut args: Vec<String> = Vec::new();
    if let Some(id) = resume_id {
        args.push("--resume".into()); args.push(id.into());
    }
    // No resume id → plain `claude`, start a fresh session.
    args.extend(extra.iter().cloned());
    AgentLaunch { program: "claude".into(), args }
}

pub fn build_codex(resume_id: Option<&str>, extra: &[String]) -> AgentLaunch {
    // Verify exact subcommand with `codex --help` on dev machine. As of writing:
    // - `codex resume <id>` to resume a specific session
    // - `codex --continue` or similar for the latest
    // If neither exists, fall back to plain `codex`.
    let mut args: Vec<String> = Vec::new();
    if let Some(id) = resume_id {
        args.push("resume".into()); args.push(id.into());
    }
    args.extend(extra.iter().cloned());
    AgentLaunch { program: "codex".into(), args }
}

static UUID_NEAR_SESSION: Lazy<Regex> = Lazy::new(|| {
    // case-insensitive, looks for "session" within ~64 chars of a uuid.
    Regex::new(r"(?i)session.{0,64}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})").unwrap()
});

/// Strip ANSI escape sequences. Cheap, not fully spec-correct, good enough.
fn strip_ansi(s: &str) -> String {
    static ANSI: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap());
    ANSI.replace_all(s, "").to_string()
}

pub fn sniff_session_id(buf: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(buf);
    let plain = strip_ansi(&s);
    UUID_NEAR_SESSION.captures(&plain).and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_uuid_after_session_word() {
        let buf = b"Welcome to Claude Code\nSession ID: 1234abcd-12ab-34cd-56ef-1234567890ab\n";
        let id = sniff_session_id(buf).unwrap();
        assert_eq!(id, "1234abcd-12ab-34cd-56ef-1234567890ab");
    }

    #[test]
    fn strips_ansi_before_match() {
        let buf = b"\x1b[1mSession\x1b[0m: 11111111-2222-3333-4444-555555555555\n";
        assert!(sniff_session_id(buf).is_some());
    }

    #[test]
    fn returns_none_when_absent() {
        let buf = b"hello world\n";
        assert!(sniff_session_id(buf).is_none());
    }
}
