use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct PtyDataEvent {
    pub node_id: String,
    pub bytes_b64: String, // base64-encoded raw bytes (ANSI intact)
}

#[derive(Serialize, Clone)]
pub struct PtyExitEvent {
    pub node_id: String,
    pub code: Option<i32>,
}
