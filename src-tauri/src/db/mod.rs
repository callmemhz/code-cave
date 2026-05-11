use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub mod canvases;
pub mod nodes;
pub mod scrollback;
pub mod app_state;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        let current: i64 = conn
            .query_row(
                "SELECT COALESCE((SELECT MAX(version) FROM schema_version), 0)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if current < 1 {
            conn.execute_batch(include_str!("../../migrations/0001_init.sql"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_creates_tables() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('canvases','nodes','node_scrollback','app_state','schema_version')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 5);
    }
}
