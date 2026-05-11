import type { Node, NodeProps } from "@xyflow/react";
import type { DbNode } from "../types";
import { AgentNode } from "./AgentNode";

type ClaudeFlowNode = Node<{ dbNode: DbNode }, "claude">;
type AgentFlowNode = Node<{ dbNode: DbNode }, "claude" | "codex">;

export function ClaudeNode(props: NodeProps<ClaudeFlowNode>) {
  return <AgentNode {...(props as unknown as NodeProps<AgentFlowNode>)} kind="claude" />;
}
