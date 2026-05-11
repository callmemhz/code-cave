use crate::db::Db;
use crate::error::AppResult;

pub fn get(db: &Db, key: &str) -> AppResult<Option<String>> {
    let conn = db.conn.lock().unwrap();
    let res = conn.query_row(
        "SELECT value FROM app_state WHERE key=?",
        [key],
        |r| r.get::<_, String>(0),
    );
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set(db: &Db, key: &str, value: &str) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO app_state (key, value) VALUES (?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}
