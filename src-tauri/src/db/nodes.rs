use crate::db::Db;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub canvas_id: String,
    pub r#type: String,        // "terminal" | "claude" | "codex" | "note"
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub title: Option<String>,
    pub data_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewNode {
    pub canvas_id: String,
    pub r#type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub title: Option<String>,
    pub data_json: String,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn list_by_canvas(db: &Db, canvas_id: &str) -> AppResult<Vec<Node>> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, canvas_id, type, x, y, width, height, title, data_json, created_at, updated_at
         FROM nodes WHERE canvas_id=?",
    )?;
    let rows = stmt
        .query_map([canvas_id], |r| {
            Ok(Node {
                id: r.get(0)?, canvas_id: r.get(1)?, r#type: r.get(2)?,
                x: r.get(3)?, y: r.get(4)?, width: r.get(5)?, height: r.get(6)?,
                title: r.get(7)?, data_json: r.get(8)?,
                created_at: r.get(9)?, updated_at: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn find(db: &Db, id: &str) -> AppResult<Option<Node>> {
    let conn = db.conn.lock().unwrap();
    let res = conn.query_row(
        "SELECT id, canvas_id, type, x, y, width, height, title, data_json, created_at, updated_at
         FROM nodes WHERE id=?",
        [id],
        |r| Ok(Node {
            id: r.get(0)?, canvas_id: r.get(1)?, r#type: r.get(2)?,
            x: r.get(3)?, y: r.get(4)?, width: r.get(5)?, height: r.get(6)?,
            title: r.get(7)?, data_json: r.get(8)?,
            created_at: r.get(9)?, updated_at: r.get(10)?,
        }),
    );
    match res {
        Ok(n) => Ok(Some(n)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn create(db: &Db, n: NewNode) -> AppResult<Node> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO nodes (id, canvas_id, type, x, y, width, height, title, data_json, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                id, n.canvas_id, n.r#type, n.x, n.y, n.width, n.height,
                n.title, n.data_json, ts, ts,
            ],
        )?;
    }
    Ok(Node {
        id, canvas_id: n.canvas_id, r#type: n.r#type,
        x: n.x, y: n.y, width: n.width, height: n.height,
        title: n.title, data_json: n.data_json,
        created_at: ts, updated_at: ts,
    })
}

pub fn update_position(db: &Db, id: &str, x: f64, y: f64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE nodes SET x=?, y=?, updated_at=? WHERE id=?",
        rusqlite::params![x, y, now(), id],
    )?;
    Ok(())
}

pub fn update_size(db: &Db, id: &str, w: f64, h: f64) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE nodes SET width=?, height=?, updated_at=? WHERE id=?",
        rusqlite::params![w, h, now(), id],
    )?;
    Ok(())
}

pub fn update_data(db: &Db, id: &str, data_json: &str) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE nodes SET data_json=?, updated_at=? WHERE id=?",
        rusqlite::params![data_json, now(), id],
    )?;
    Ok(())
}

pub fn update_title(db: &Db, id: &str, title: Option<&str>) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE nodes SET title=?, updated_at=? WHERE id=?",
        rusqlite::params![title, now(), id],
    )?;
    Ok(())
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM nodes WHERE id=?", rusqlite::params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::canvases;

    fn setup() -> (Db, String) {
        let db = Db::open_in_memory().unwrap();
        let c = canvases::create(&db, "default").unwrap();
        (db, c.id)
    }

    #[test]
    fn create_and_list() {
        let (db, cid) = setup();
        let n = create(&db, NewNode {
            canvas_id: cid.clone(), r#type: "note".into(),
            x: 1.0, y: 2.0, width: 300.0, height: 200.0,
            title: None, data_json: "{}".into(),
        }).unwrap();
        let all = list_by_canvas(&db, &cid).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, n.id);
    }

    #[test]
    fn update_position_works() {
        let (db, cid) = setup();
        let n = create(&db, NewNode {
            canvas_id: cid.clone(), r#type: "note".into(),
            x: 0.0, y: 0.0, width: 300.0, height: 200.0,
            title: None, data_json: "{}".into(),
        }).unwrap();
        update_position(&db, &n.id, 50.0, 60.0).unwrap();
        let after = list_by_canvas(&db, &cid).unwrap();
        assert_eq!(after[0].x, 50.0);
        assert_eq!(after[0].y, 60.0);
    }

    #[test]
    fn cascading_delete_when_canvas_deleted() {
        let (db, cid) = setup();
        create(&db, NewNode {
            canvas_id: cid.clone(), r#type: "note".into(),
            x: 0.0, y: 0.0, width: 1.0, height: 1.0,
            title: None, data_json: "{}".into(),
        }).unwrap();
        canvases::delete(&db, &cid).unwrap();
        assert!(list_by_canvas(&db, &cid).unwrap().is_empty());
    }
}
