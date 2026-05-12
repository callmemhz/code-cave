import { useEffect, useRef, useState } from "react";

interface Props {
  type: "terminal" | "claude" | "codex";
  defaultCwd: string;
  recents: string[];
  onSubmit: (cwd: string) => void;
  onCancel: () => void;
}

export function CwdPrompt({ type, defaultCwd, recents, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState(defaultCwd);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (override?: string) => onSubmit((override ?? draft).trim() || "~");

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1a1a1a", color: "#e0e0e0",
        border: "1px solid #444", borderRadius: 6,
        padding: 16, minWidth: 440, maxWidth: 560,
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
          placeholder={defaultCwd || "~"}
          spellCheck={false}
          style={{
            width: "100%", background: "#0d0d0d", color: "#e0e0e0",
            border: "1px solid #555", borderRadius: 4, padding: "6px 8px",
            fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13,
            outline: "none",
          }}
        />
        {recents.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>RECENT</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recents.map((p) => (
                <div
                  key={p}
                  onClick={() => { setDraft(p); submit(p); }}
                  title={p}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 3,
                    cursor: "pointer",
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                    fontSize: 12,
                    color: "#bbb",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#252525")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {p}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btn}>Cancel</button>
          <button onClick={() => submit()} style={{ ...btn, background: "#2a4a7a", borderColor: "#3a5a8a" }}>Create</button>
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
