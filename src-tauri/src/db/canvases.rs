use crate::db::Db;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Canvas {
    pub id: String,
    pub name: String,
    pub viewport_x: f64,
    pub viewport_y: f64,
    pub viewport_zoom: f64,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn list(db: &Db) -> AppResult<Vec<Canvas>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, viewport_x, viewport_y, viewport_zoom, position, created_at, updated_at
         FROM canvases ORDER BY position ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Canvas {
                id: r.get(0)?,
                name: r.get(1)?,
                viewport_x: r.get(2)?,
                viewport_y: r.get(3)?,
                viewport_zoom: r.get(4)?,
                position: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create(db: &Db, name: &str) -> AppResult<Canvas> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    let conn = db.conn.lock().unwrap();
    let max_pos: i64 = conn
        .query_row("SELECT COALESCE(MAX(position), -1) FROM canvases", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO canvases (id, name, viewport_x, viewport_y, viewport_zoom, position, created_at, updated_at)
         VALUES (?, ?, 0, 0, 1, ?, ?, ?)",
        rusqlite::params![id, name, max_pos + 1, ts, ts],
    )?;
    Ok(Canvas {
        id, name: name.to_string(),
        viewport_x: 0.0, viewport_y: 0.0, viewport_zoom: 1.0,
        position: max_pos + 1, created_at: ts, updated_at: ts,
    })
}

pub fn update_viewport(db: &Db, id: &str, x: f64, y: f64, zoom: f64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE canvases SET viewport_x=?, viewport_y=?, viewport_zoom=?, updated_at=? WHERE id=?",
        rusqlite::params![x, y, zoom, now(), id],
    )?;
    Ok(())
}

pub fn rename(db: &Db, id: &str, name: &str) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE canvases SET name=?, updated_at=? WHERE id=?",
        rusqlite::params![name, now(), id],
    )?;
    Ok(())
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM canvases WHERE id=?", rusqlite::params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_list_returns_one() {
        let db = Db::open_in_memory().unwrap();
        let c = create(&db, "default").unwrap();
        let all = list(&db).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, c.id);
        assert_eq!(all[0].name, "default");
        assert_eq!(all[0].position, 0);
    }

    #[test]
    fn update_viewport_persists() {
        let db = Db::open_in_memory().unwrap();
        let c = create(&db, "x").unwrap();
        update_viewport(&db, &c.id, 10.0, 20.0, 1.5).unwrap();
        let all = list(&db).unwrap();
        assert_eq!(all[0].viewport_x, 10.0);
        assert_eq!(all[0].viewport_y, 20.0);
        assert_eq!(all[0].viewport_zoom, 1.5);
    }

    #[test]
    fn delete_removes() {
        let db = Db::open_in_memory().unwrap();
        let c = create(&db, "x").unwrap();
        delete(&db, &c.id).unwrap();
        assert!(list(&db).unwrap().is_empty());
    }
}
