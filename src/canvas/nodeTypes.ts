import type { NodeTypes } from "@xyflow/react";
import { NoteNode } from "../nodes/NoteNode";
import { TerminalNode } from "../nodes/TerminalNode";
import { ClaudeNode } from "../nodes/ClaudeNode";
import { CodexNode } from "../nodes/CodexNode";

export const nodeTypes: NodeTypes = {
  note: NoteNode,
  terminal: TerminalNode,
  claude: ClaudeNode,
  codex: CodexNode,
};
