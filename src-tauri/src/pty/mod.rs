pub mod ringbuf;
pub mod session;

use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

pub use session::PtySession;

pub struct PtySupervisor {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

impl PtySupervisor {
    pub fn new() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }

    pub fn get(&self, node_id: &str) -> Option<Arc<PtySession>> {
        self.sessions.lock().get(node_id).cloned()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self, app: AppHandle, node_id: String,
        cwd: &str, program: &str, args: &[String],
        env: &HashMap<String,String>, cols: u16, rows: u16,
        initial_scrollback: Vec<u8>,
        sniff: Option<session::SniffCallback>,
        on_sniff: Option<session::OnSniffCallback>,
    ) -> AppResult<Arc<PtySession>> {
        let mut map = self.sessions.lock();
        if let Some(existing) = map.get(&node_id) {
            if existing.is_alive() {
                return Err(AppError::Invalid(format!("pty already running for {node_id}")));
            }
        }
        let s = PtySession::spawn(app, node_id.clone(), cwd, program, args, env, cols, rows, initial_scrollback, sniff, on_sniff)?;
        map.insert(node_id, s.clone());
        Ok(s)
    }

    pub fn kill(&self, node_id: &str) -> AppResult<()> {
        let mut map = self.sessions.lock();
        map.remove(node_id);
        Ok(())
    }

    pub fn snapshot(&self, node_id: &str) -> Option<Vec<u8>> {
        self.sessions.lock().get(node_id).map(|s| s.snapshot())
    }

    pub fn collect_snapshots(&self) -> Vec<(String, Vec<u8>)> {
        self.sessions.lock().iter().map(|(k, v)| (k.clone(), v.snapshot())).collect()
    }
}
