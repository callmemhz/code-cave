# Code Cave — Design

**Date**: 2026-05-11
**Status**: Draft (approved by user, pre-implementation)
**Author**: brainstorm with Claude

## Goal

A Tauri desktop app that puts terminals and CLI agents (Claude Code, Codex) on a single infinite canvas alongside Markdown notes. The defining feature: **every session resumes where it left off**, both when the user reopens a closed window and when the user fully restarts the app.

Inspired by [DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove) but scoped down. Out of scope for MVP: tasks, archives, global search, git-worktree workspace isolation, image paste, label colors, multi-workspace, standalone daemon binary, headless server / web UI, Windows and Linux polish.

## Stack

- **Shell**: Tauri 2 (Rust main process + WebView renderer)
- **Frontend**: React 19 + Vite + TypeScript + Zustand
- **Canvas**: `@xyflow/react` v12 (custom node components)
- **Terminal**: `@xterm/xterm` v6 with addons: fit, webgl, search, serialize, web-links, unicode11
- **PTY**: `portable-pty` crate in Rust main process
- **DB**: `rusqlite` (bundled), debounced writes
- **Platform**: macOS-first; Linux/Windows compile-clean but unpolished

## Architecture

```
┌───────────────────────────────────────────────┐
│ Tauri App (macOS)                             │
│                                               │
│  ┌──────────────────────────┐                 │
│  │ Renderer (React + Vite)  │                 │
│  │  - xyflow canvas          │                │
│  │  - xterm.js terminal nodes│                │
│  │  - Zustand store          │                │
│  └────────┬─────────────────┘                 │
│           │ Tauri IPC (events + invoke)       │
│  ┌────────▼─────────────────┐                 │
│  │ Tauri main (Rust)        │                 │
│  │  - command handlers      │                 │
│  │  - PTY supervisor        │ ── portable-pty │
│  │  - SQLite (rusqlite)     │                 │
│  │  - tray icon (close→tray)│                 │
│  └──────────────────────────┘                 │
└───────────────────────────────────────────────┘
```

The Tauri main (Rust) process owns all PTYs and the SQLite handle. Closing the window does not quit the app — there is a tray icon and the main process continues running, so live PTYs stay attached. Only Cmd+Q (or "Quit from tray") tears down PTYs.

We deliberately do **not** ship a separate daemon binary in MVP. Going further (independent `code-cave-worker` like opencove's worker, headless mode, remote access) is deferred until the single-process design proves limiting.

## Session persistence — the core feature

Two defense lines:

### Line A: process stays alive (window-lifecycle resume)
- Each CLI node has one PTY managed by the Rust `PtyHost`.
- PTY output is fanned out:
  1. Stream to renderer over a Tauri event channel → xterm renders live.
  2. Written into an in-memory ring buffer; flushed (debounced ~500ms) into SQLite `node_scrollback` (cap ~400 KB per node, matching opencove).
- Closing the window: PTY stays alive, ring buffer keeps appending, SQLite keeps catching up.
- Reopening: renderer pulls the saved scrollback from SQLite to repaint xterm, then subscribes to the live event channel to continue receiving output.

### Line B: process died (app-restart resume)
When the app fully quits (Cmd+Q, crash, machine reboot) PTY processes are gone. On next launch:
- **Terminal node**: starts a fresh shell at the saved `cwd`; xterm displays the saved scrollback (read-only history) followed by the new prompt. No state restore — just visual continuity.
- **Claude node**: launches `claude --resume <session_id>` (falls back to `--continue` if no id stored). The session id is captured during normal operation (we parse it from Claude's startup banner or whatever it logs; concrete mechanism in implementation plan).
- **Codex node**: launches `codex resume <session_id>` (exact CLI to confirm during implementation).
- **Note node**: just rendered from saved Markdown.

A status badge on each CLI node reflects this lifecycle:
- ● green = process alive
- ○ gray = process dead, resumable next launch
- ✕ red = launch failed (e.g. binary not found, resume id invalid)

## Data model (SQLite)

```sql
CREATE TABLE canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  viewport_x REAL NOT NULL DEFAULT 0,
  viewport_y REAL NOT NULL DEFAULT 0,
  viewport_zoom REAL NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,         -- order in the top tab bar
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                -- 'terminal' | 'claude' | 'codex' | 'note'
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  title TEXT,
  data_json TEXT NOT NULL,           -- type-specific payload (see below)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE node_scrollback (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  content BLOB NOT NULL,             -- raw bytes including ANSI; capped ~400KB
  updated_at INTEGER NOT NULL
);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- known keys: 'active_canvas_id', 'window_geometry'
```

`data_json` payloads:
- `terminal`: `{ cwd: string, shell: string, env: Record<string,string> }`
- `claude` / `codex`: `{ cwd, args: string[], resume_session_id: string | null }`
- `note`: `{ content: string, preview_mode: boolean }`

Scrollback lives in its own table because (a) it's the largest and most frequently written field, and (b) it lets us read node metadata cheaply without dragging the BLOB.

## Node behavior

| Type | Toolbar | After app restart |
|---|---|---|
| **Terminal** | restart shell · kill · change cwd | fresh shell at saved cwd; old scrollback shown above new prompt |
| **Claude** | restart (`--resume`) · new session · kill · cwd | `claude --resume <id>` |
| **Codex** | restart (`resume`) · new session · kill · cwd | `codex resume <id>` |
| **Note** | edit ⇄ preview toggle | rendered from stored Markdown |

Every node has a header showing: title (dbl-click to rename), cwd (for CLI nodes), status badge, toolbar.

## Canvas UX

- xyflow default interactions: pan, zoom, marquee multi-select, drag, resize.
- Multi-canvas: **top tab bar** with "+" to add, right-click → rename / delete / duplicate.
- Right-click on empty canvas: context menu → New Terminal / Claude / Codex / Note.
- Per-canvas viewport (x/y/zoom) saved on debounce.
- Single Zustand store owns canvas+nodes; subscribes to Rust-emitted events for PTY output and lifecycle changes.

## Project layout

```
code-cave/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── pty/             # portable-pty supervisor, ring buffer, event fan-out
│   │   ├── db/              # rusqlite, migrations, scrollback writer
│   │   ├── commands.rs      # #[tauri::command] surface called from renderer
│   │   ├── agents.rs        # claude/codex launch + resume logic
│   │   └── tray.rs
│   ├── migrations/          # *.sql files applied at boot
│   └── Cargo.toml
├── src/                     # React renderer
│   ├── canvas/              # xyflow setup, layout glue
│   ├── nodes/
│   │   ├── TerminalNode.tsx
│   │   ├── ClaudeNode.tsx
│   │   ├── CodexNode.tsx
│   │   └── NoteNode.tsx
│   ├── store/               # zustand slices
│   ├── ipc/                 # invoke + event wrappers
│   └── main.tsx
├── package.json
└── docs/superpowers/specs/
```

## Out of scope (deliberately)

- Tasks, archives, global search, label colors, image paste
- Git worktree workspace isolation
- Multiple workspaces (single workspace, multi-canvas instead)
- Standalone daemon binary / headless server / web UI / remote access
- Windows / Linux polish

## Open questions for the implementation plan

These don't change the spec but need answers during implementation:

1. **How to capture Claude's session id** at runtime so we can `--resume` later. Likely: parse Claude's startup banner, or watch `~/.claude/projects/.../` jsonl files for the matching session.
2. **Codex resume CLI** — confirm exact subcommand and id storage.
3. **xterm ↔ SQLite scrollback format** — store raw PTY bytes (ANSI intact) or xterm's serialize addon output. Raw bytes are simpler and let us re-feed them on reopen.
4. **PTY event channel back-pressure** — if renderer is slow, we shouldn't pause the PTY. Drop-to-buffer policy needed.
