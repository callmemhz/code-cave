export type NodeType = "terminal" | "claude" | "codex" | "note";

export interface Canvas {
  id: string;
  name: string;
  viewport_x: number;
  viewport_y: number;
  viewport_zoom: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface DbNode {
  id: string;
  canvas_id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string | null;
  data_json: string;
  created_at: number;
  updated_at: number;
}

export interface NewNodeInput {
  canvas_id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string | null;
  data_json: string;
}

// Type-specific payloads stored as JSON in data_json.
export interface TerminalData { cwd: string; shell: string; env: Record<string,string>; }
export interface AgentData { cwd: string; args: string[]; resume_session_id: string | null; }
export interface NoteData { content: string; preview_mode: boolean; }
