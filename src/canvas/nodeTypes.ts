import type { NodeTypes } from "@xyflow/react";
import { NoteNode } from "../nodes/NoteNode";
import { TerminalNode } from "../nodes/TerminalNode";

export const nodeTypes: NodeTypes = {
  note: NoteNode,
  terminal: TerminalNode,
};
