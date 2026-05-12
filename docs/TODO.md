# TODO

## Architecture / persistence

- [ ] **Real session persistence (option A: daemon).** Today PTY processes
      are owned by the Tauri main process, so Cmd+Q kills every shell,
      claude, codex, etc. running in panes. To get tmux-like persistence
      across app restarts (running processes survive, cwd intact, command
      history intact, scrollback authoritative), refactor the PtySupervisor
      out of Tauri main into a long-lived sidecar daemon (e.g.
      `code-cave-worker`). UI talks to the daemon over IPC; closing or
      restarting the UI doesn't touch PTYs.
      Reference implementation: OpenCove's worker process
      (`/tmp/opencove-investigate/src/app/worker/`).
      Interim band-aids in place today:
      - cwd tracked via lsof polling (so `cd` survives restart at the
        shell-launch-cwd level).
      - scrollback persisted to SQLite and replayed on reattach.
      Both are visual continuity, not actual process continuity.
