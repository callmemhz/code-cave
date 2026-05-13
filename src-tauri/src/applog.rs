use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

pub fn init(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = FILE.set(Mutex::new(f));
        let _ = FILE.get().unwrap().lock().map(|mut g| {
            let _ = writeln!(g, "\n===== code-cave session @ {} =====", now_iso());
        });
    }
}

pub fn line(s: &str) {
    eprintln!("{}", s);
    if let Some(m) = FILE.get() {
        if let Ok(mut f) = m.lock() {
            let _ = writeln!(f, "{} {}", now_iso(), s);
            let _ = f.flush();
        }
    }
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Convert to a coarse local-ish HH:MM:SS — good enough for log scanning.
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02}Z", h, m, s)
}

#[macro_export]
macro_rules! log_line {
    ($($t:tt)*) => {
        $crate::applog::line(&format!($($t)*))
    };
}
