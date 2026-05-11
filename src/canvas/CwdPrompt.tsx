import { useEffect, useRef, useState } from "react";

interface Props {
  type: "terminal" | "claude" | "codex";
  defaultCwd: string;
  onSubmit: (cwd: string) => void;
  onCancel: () => void;
}

export function CwdPrompt({ type, defaultCwd, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState(defaultCwd);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => onSubmit(draft.trim() || "~");

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1a1a1a", color: "#e0e0e0",
        border: "1px solid #444", borderRadius: 6,
        padding: 16, minWidth: 380,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        fontSize: 13,
      }}>
        <div style={{ marginBottom: 10, opacity: 0.8 }}>
          Working directory for new <b>{type}</b>:
        </div>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
          spellCheck={false}
          style={{
            width: "100%", background: "#0d0d0d", color: "#e0e0e0",
            border: "1px solid #555", borderRadius: 4, padding: "6px 8px",
            fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13,
            outline: "none",
          }}
        />
        <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btn}>Cancel</button>
          <button onClick={submit} style={{ ...btn, background: "#2a4a7a", borderColor: "#3a5a8a" }}>Create</button>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#2a2a2a", color: "#ddd",
  border: "1px solid #444", borderRadius: 4,
  padding: "4px 12px", fontSize: 13, cursor: "pointer",
};
