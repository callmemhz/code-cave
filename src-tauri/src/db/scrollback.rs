use crate::db::Db;
use crate::error::AppResult;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub fn read(db: &Db, node_id: &str) -> AppResult<Vec<u8>> {
    let conn = db.conn.lock().unwrap();
    let res = conn.query_row(
        "SELECT content FROM node_scrollback WHERE node_id=?",
        [node_id],
        |r| r.get::<_, Vec<u8>>(0),
    );
    match res {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn write(db: &Db, node_id: &str, content: &[u8]) -> AppResult<()> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO node_scrollback (node_id, content, updated_at) VALUES (?,?,?)
         ON CONFLICT(node_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at",
        rusqlite::params![node_id, content, ts],
    )?;
    Ok(())
}

/// Tracks last-write times to debounce frequent updates from PTY output.
pub struct ScrollbackWriter {
    last_write: Mutex<HashMap<String, Instant>>,
}

impl ScrollbackWriter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { last_write: Mutex::new(HashMap::new()) })
    }

    /// Returns true if enough time has elapsed since last write for this node.
    pub fn should_write(&self, node_id: &str, min_interval: Duration) -> bool {
        let mut map = self.last_write.lock();
        let now = Instant::now();
        match map.get(node_id) {
            Some(&last) if now.duration_since(last) < min_interval => false,
            _ => { map.insert(node_id.to_string(), now); true }
        }
    }
}
