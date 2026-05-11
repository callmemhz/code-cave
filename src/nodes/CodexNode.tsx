import type { Node, NodeProps } from "@xyflow/react";
import type { DbNode } from "../types";
import { AgentNode } from "./AgentNode";

type CodexFlowNode = Node<{ dbNode: DbNode }, "codex">;
type AgentFlowNode = Node<{ dbNode: DbNode }, "claude" | "codex">;

export function CodexNode(props: NodeProps<CodexFlowNode>) {
  return <AgentNode {...(props as unknown as NodeProps<AgentFlowNode>)} kind="codex" />;
}
