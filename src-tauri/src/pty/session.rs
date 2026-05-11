use crate::error::{AppError, AppResult};
use crate::events::{PtyDataEvent, PtyExitEvent};
use crate::pty::ringbuf::RingBuf;
use base64::Engine;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub type SniffCallback = Box<dyn Fn(&[u8]) -> Option<String> + Send + Sync>;
pub type OnSniffCallback = Box<dyn Fn(String) + Send + Sync>;

const SCROLLBACK_CAP: usize = 400 * 1024;

pub struct PtySession {
    node_id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    pub scrollback: Arc<Mutex<RingBuf>>,
    alive: Arc<std::sync::atomic::AtomicBool>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        node_id: String,
        cwd: &str,
        program: &str,
        args: &[String],
        env: &HashMap<String, String>,
        cols: u16, rows: u16,
        initial_scrollback: Vec<u8>,
        sniff: Option<SniffCallback>,
        on_sniff: Option<OnSniffCallback>,
    ) -> AppResult<Arc<Self>> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Pty(format!("openpty: {e}")))?;

        let mut cmd = CommandBuilder::new(program);
        for a in args { cmd.arg(a); }
        cmd.cwd(shellexpand_or_passthrough(cwd));
        for (k, v) in env { cmd.env(k, v); }

        let mut child = pair.slave.spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("spawn: {e}")))?;
        drop(pair.slave);

        let writer = pair.master.take_writer()
            .map_err(|e| AppError::Pty(format!("take_writer: {e}")))?;
        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| AppError::Pty(format!("try_clone_reader: {e}")))?;

        let mut rb = RingBuf::new(SCROLLBACK_CAP);
        rb.push(&initial_scrollback);
        let scrollback = Arc::new(Mutex::new(rb));
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));

        let session = Arc::new(Self {
            node_id: node_id.clone(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            scrollback: scrollback.clone(),
            alive: alive.clone(),
        });

        // Reader thread (blocking IO).
        let app_for_reader = app.clone();
        let nid_for_reader = node_id.clone();
        let sb_for_reader = scrollback.clone();
        let alive_for_reader = alive.clone();
        std::thread::spawn(move || {
            let engine = base64::engine::general_purpose::STANDARD;
            let mut buf = [0u8; 8192];
            let mut sniff_done = false;
            let mut bytes_seen: usize = 0;
            let mut sniff_window: Vec<u8> = Vec::new();
            const SNIFF_LIMIT: usize = 32 * 1024;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        sb_for_reader.lock().push(&buf[..n]);
                        if !sniff_done && bytes_seen < SNIFF_LIMIT {
                            sniff_window.extend_from_slice(&buf[..n]);
                            bytes_seen += n;
                            if let Some(sniff_fn) = sniff.as_ref() {
                                if let Some(id) = sniff_fn(&sniff_window) {
                                    if let Some(cb) = on_sniff.as_ref() { cb(id); }
                                    sniff_done = true;
                                    sniff_window.clear();
                                }
                            }
                        }
                        let payload = PtyDataEvent {
                            node_id: nid_for_reader.clone(),
                            bytes_b64: engine.encode(&buf[..n]),
                        };
                        let _ = app_for_reader.emit(
                            &format!("pty:data:{nid_for_reader}"),
                            payload,
                        );
                    }
                    Err(_) => break,
                }
            }
            alive_for_reader.store(false, std::sync::atomic::Ordering::SeqCst);
            let code = child.wait().ok().and_then(|s| {
                let raw: u32 = s.exit_code();
                i32::try_from(raw).ok()
            });
            let _ = app_for_reader.emit(
                &format!("pty:exit:{nid_for_reader}"),
                PtyExitEvent { node_id: nid_for_reader.clone(), code },
            );
        });

        Ok(session)
    }

    pub fn write(&self, bytes: &[u8]) -> AppResult<()> {
        self.writer.lock().write_all(bytes)
            .map_err(|e| AppError::Pty(format!("write: {e}")))?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        self.master.lock().resize(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Pty(format!("resize: {e}")))?;
        Ok(())
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.scrollback.lock().snapshot()
    }

    pub fn node_id(&self) -> &str { &self.node_id }
}

fn shellexpand_or_passthrough(p: &str) -> String {
    if let Some(stripped) = p.strip_prefix("~") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), stripped);
        }
    }
    p.to_string()
}
