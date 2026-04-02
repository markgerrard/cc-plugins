# Gemini Plugin ACP Refactor

**Date:** 2026-04-02
**Status:** Approved
**Scope:** Refactor the Gemini Claude Code plugin from CLI-wrapper to ACP-based transport

## Summary

Replace the current approach of spawning `gemini` CLI and scraping stdout with a proper ACP (Agent Client Protocol) integration using `gemini --acp`. The Python ACP SDK handles the JSON-RPC transport; Node stays as a thin command adapter.

## Motivation

The current plugin spawns `gemini <args>`, collects stdout as text, and parses it. This means:

- No structured communication — output is free-form text
- No session management — every command is stateless
- No cancel support — kill the process and hope
- No streaming events — wait for full completion or nothing
- No file-access awareness — can't track what Gemini touched

Gemini CLI supports ACP natively via `gemini --acp`, providing JSON-RPC over stdio with session lifecycle, structured events, and proper cancel semantics.

## Architecture

```
Node plugin (thin adapter)          Python ACP runtime (owns complexity)
┌──────────────────────────┐       ┌──────────────────────────────────┐
│ gemini-companion.mjs     │       │ gemini-acp.py                    │
│ - command parsing        │──────>│ - ACP transport (SDK-backed)     │
│ - JSON envelope reading  │stdout │ - session lifecycle              │
│ - Claude-facing UX       │<──────│ - job persistence + locking      │
│ - streaming JSONL reader │stderr │ - supervised background exec     │
└──────────────────────────┘  diag │ - preflight checks               │
                                   │ - event normalization            │
                                   └───────────┬──────────────────────┘
                                               │ spawns
                                               ▼
                                   ┌──────────────────────────────────┐
                                   │ gemini --acp                     │
                                   │ JSON-RPC 2.0 over stdio          │
                                   └──────────────────────────────────┘
```

### Separation of concerns

- **Node**: command surface, arg parsing, result presentation for Claude. Does NOT own job state, lifecycle, PIDs, or session IDs.
- **Python**: single source of truth for ACP transport, sessions, jobs, persistence. Canonical structured output via stdout JSON.
- **Gemini CLI**: external subprocess agent behind a narrow ACP boundary.

### Why Python for the ACP layer

- ACP Python SDK has materially better support than any Node equivalent
- Working reference implementation exists (Vibe plugin's `acp_client.py`)
- The language of the wrapper matters less than the reliability of the protocol boundary
- Clean CLI boundary between Node orchestration and Python runtime is normal and correct

## CLI Contract

### Boundary rules

- **stdout**: machine JSON only when called from Node. `--text` for direct human use only.
- **stderr**: diagnostics only, never parsed by Node
- **Exit codes**: `0` success, `1` runtime error, `2` preflight failure, `3` cancelled

### Output modes (explicit, never inferred)

| Mode | Flag | Behavior |
|------|------|----------|
| Default | (none) | Single JSON envelope on completion |
| Streaming | `--stream` | JSONL event stream, final line has `"terminal": true` |
| Text | `--text` | Human-readable plain text (not for Node) |
| Background | `--background` | Single JSON envelope (job ID + status), exit immediately |

`--background --stream` is invalid. Background returns one envelope only.

### Subcommands

```
python3 gemini-acp.py <subcommand> [flags] [prompt...]
```

| Subcommand | Preflight | ACP Session | Resume |
|---|---|---|---|
| `setup` | full diagnostic | no | n/a |
| `ask <prompt>` | yes | fresh | allowed |
| `task <prompt>` | yes | fresh | allowed |
| `review` | yes | fresh | no |
| `ui-review` | yes | fresh | no |
| `ui-design` | yes | fresh | no |
| `status [--job ID]` | no | no | n/a |
| `result [--job ID]` | no | no | n/a |
| `cancel [--job ID]` | no | no | n/a |
| `logs [--job ID]` | no | no | n/a |
| `worker-run --job ID` | yes | per job | n/a |

`worker-run` is internal — used by background parent to spawn the detached worker.

### Shared flags

| Flag | Effect |
|---|---|
| `--background` | Detach, return job ID immediately |
| `--stream` | JSONL event stream (foreground only) |
| `--model <name>` | Override model (aliases resolved Python-side) |
| `--json` | JSON output (default) |
| `--text` | Plain text output |
| `--resume <job-id>` | Reattach to existing session (ask/task only) |
| `--cwd <path>` | Override working directory |

### Success envelope

```json
{
  "schema_version": 1,
  "ok": true,
  "command": "task",
  "job_id": "gem-20260402-221500-a1b2",
  "session_id": "acp-session-uuid",
  "cwd": "/srv/sites/papi-payment-callback-dev",
  "model": "gemini-2.5-pro",
  "status": "completed",
  "text": "...",
  "tokens": null,
  "files_changed": null,
  "duration_ms": 3200,
  "started_at": "2026-04-02T22:15:00.000Z",
  "ended_at": "2026-04-02T22:15:03.200Z",
  "warnings": [],
  "result_available": true,
  "exit_code": 0
}
```

`tokens` and `files_changed` are nullable — populated when Gemini ACP reports them, null otherwise.

### Error envelope

```json
{
  "schema_version": 1,
  "ok": false,
  "command": "ask",
  "error": "Non-interactive auth failed: Gemini CLI requires login",
  "error_code": "preflight_auth",
  "exit_code": 2
}
```

### Status envelopes

**Single job** (`status --job <id>`):
```json
{
  "schema_version": 1,
  "ok": true,
  "command": "status",
  "job": { "job_id": "...", "status": "running", ... }
}
```

**Job list** (`status` bare, scoped to cwd):
```json
{
  "schema_version": 1,
  "ok": true,
  "command": "status",
  "cwd": "/srv/...",
  "jobs": [...]
}
```

### Streaming JSONL (`--stream`)

```jsonl
{"schema_version":1,"type":"event","event":"session_started","source":"runtime","job_id":"gem-...","session_id":"acp-...","timestamp":"...","data":{}}
{"schema_version":1,"type":"event","event":"tool_use_start","source":"tool","job_id":"gem-...","session_id":"acp-...","timestamp":"...","data":{"tool":"write_file","path":"/tmp/foo.py"}}
{"schema_version":1,"type":"event","event":"text_delta","source":"agent","job_id":"gem-...","session_id":"acp-...","timestamp":"...","data":{"text":"Creating file..."}}
{"schema_version":1,"type":"result","terminal":true,"ok":true,"command":"task",...}
```

- Intermediate `text_delta` events are incremental only
- Final terminal envelope `text` contains the fully assembled output
- Unknown ACP events preserved with `"event": "unknown"` and `"raw_event_type": "<original>"`
- `source` values: `agent`, `tool`, `runtime`, `supervisor`

### Logs

- `logs --job <id>` → structured JSONL event records (default)
- `logs --job <id> --text` → rendered human-readable tail
- Reads persisted event log only. Does not reconnect to ACP or inspect live subprocess.

### Job lookup precedence

For `status`, `result`, `cancel`, `logs`:

1. `--job <id>` provided → use it directly
2. No `--job`:
   - `status` bare → list all jobs scoped to current cwd
   - `cancel` bare → most recent non-terminal job in cwd (if exactly one)
   - `result` bare → most recent terminal job with `result_available=true` in cwd (if exactly one)
   - `logs` bare → most recent any-state job in cwd (if exactly one)
   - Zero or multiple candidates → structured ambiguity error

## Job Model

### Lifecycle

```
queued → running → completed
                 → failed
                 → cancelling → cancelled
                              → failed (cancel timeout)
```

- **queued**: job record created, ACP session not yet started
- **running**: ACP handshake complete, prompt sent
- **cancelling**: SIGTERM sent to process group, waiting for exit
- **completed/failed/cancelled**: terminal states
- **stale**: supervisory correction only — job claims running/cancelling but process is gone. Never set by workers; only set by status reconciliation.

### Job record (`job.json`)

```json
{
  "schema_version": 1,
  "job_id": "gem-20260402-221500-a1b2",
  "parent_job_id": null,
  "command": "task",
  "prompt": "Create a calculator...",
  "cwd": "/srv/sites/papi-payment-callback-dev",
  "model": "gemini-2.5-pro",
  "session_id": null,
  "status": "queued",
  "error_code": null,
  "error": null,
  "pid": null,
  "pgid": null,
  "mode": "foreground",
  "output_mode": "json",
  "env_fingerprint": null,
  "created_at": "2026-04-02T22:15:00.000Z",
  "started_at": null,
  "last_updated_at": "2026-04-02T22:15:00.000Z",
  "ended_at": null,
  "result_available": false,
  "exit_code": null
}
```

- `pid`/`pgid` are null in `queued`, populated in `running`, preserved historically in terminal states
- `parent_job_id` set when `--resume` creates a new job referencing an old session
- `env_fingerprint` captures enough runtime context to detect environment drift (not secrets)

### Storage layout

```
~/.gemini-acp/jobs/
  gem-20260402-221500-a1b2/
    job.json          — job record (atomic writes + file locking)
    events.jsonl      — raw ACP event log (append-only, single writer)
    result.json       — final result envelope (written on ANY terminal transition)
```

- `job.json` is single source of truth for state
- `events.jsonl` is append-only, written only by the runtime/worker process
- `result.json` written once on any terminal state (completed, failed, cancelled) — success envelope on success, error envelope on failure/cancel
- Supervisor commands update `job.json` and `result.json` only, never `events.jsonl`

### Persistence rules

- **Atomic writes**: write to `job.json.tmp`, then `os.replace()` to `job.json`
- **File locking**: per-job advisory lock when mutating state (prevents races between runtime finishing, cancel firing, and stale reconciliation)
- **Single event writer**: only the runtime/worker appends to `events.jsonl`

### Resume rules

- `--resume <job-id>` valid on `ask` and `task` only
- Creates a new job record with new `job_id`, same `session_id`, `parent_job_id` pointing back
- Different `pid`/`pgid` from parent job

## Supervisor

### Foreground execution

```
1. Validate args
2. Run preflight (exit 2 on failure)
3. Create job record (queued)
4. Spawn gemini --acp
5. ACP handshake → update to running
6. Stream events to events.jsonl
7. If --stream: also write JSONL events to stdout
8. On completion → write result.json, update job, print terminal envelope
9. On failure → write result.json with error, update job, print error envelope
```

### Background execution

```
Parent process:
1. Validate args
2. Create job record (queued)
3. Spawn detached worker: python3 gemini-acp.py worker-run --job <id>
4. Print background envelope to stdout
5. Exit immediately (exit 0)

Worker process (detached, new process group):
1. Run preflight (update job to failed if fails)
2. Spawn gemini --acp
3. ACP handshake → update to running
4. Stream events to events.jsonl
5. On completion → write result.json, update job
6. On failure → write result.json with error, update job
```

### Cancellation

1. Send ACP `cancel` request (transport-level best effort)
2. Set job status to `cancelling`
3. Send SIGTERM to process group (`os.killpg(pgid, SIGTERM)`)
4. Wait up to configurable timeout (default 10s)
5. If still alive → SIGKILL
6. Update job to `cancelled` or `failed` (cancel_timeout)

Transport `cancel()` is best effort only. Supervisor owns process-group kill authority.

### Stale detection

On `status` commands, for any `running`/`cancelling` jobs:
- Check if `pid` is alive (`os.kill(pid, 0)`)
- If process gone → mark `stale`
- Only supervisor/status reconciliation sets `stale`, never workers

### Cleanup

No automatic deletion in v1. Jobs persist until explicitly cleaned. Layout supports future `gc`/`prune`/retention commands.

## Transport Abstraction

### AgentTransport ABC

```python
class AgentTransport(ABC):
    @abstractmethod
    async def spawn(self, cwd: str, env: dict) -> None: ...

    @abstractmethod
    async def initialize(self, timeout_s: float = 10.0) -> InitResult: ...

    @abstractmethod
    async def new_session(self) -> str: ...

    @abstractmethod
    async def load_session(self, session_id: str) -> str: ...

    @abstractmethod
    async def send_prompt(self, text: str) -> None: ...

    @abstractmethod
    async def stream_events(self) -> AsyncIterator[dict]: ...

    @abstractmethod
    async def cancel(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    def is_alive(self) -> bool: ...
```

- `cwd` is passed at `spawn()` time only — not mixed into session methods
- `initialize()` returns typed `InitResult` with capabilities, not a loose dict
- `new_session()` / `load_session()` are pure ACP session operations
- `cancel()` is transport-level best effort (ACP cancel request)
- `close()` handles: graceful ACP shutdown → transport teardown → process termination fallback
- Model selection is a thin optional adapter, failure is non-fatal

### GeminiAcpTransport

SDK-backed implementation:
- Spawns `gemini --acp` as subprocess
- Uses `acp` Python SDK for JSON-RPC framing
- `initialize()` validates handshake within configurable timeout, detects interactive login
- Unknown ACP events passed through with `raw_event_type` preserved

### Configuration

Timeouts are runtime-configurable, not hard-coded:
- `handshake_timeout_s` (default 10)
- `shutdown_timeout_s` (default 5)
- `cancel_timeout_s` (default 10)

### Preflight

```python
@dataclass
class PreflightResult:
    gemini_found: bool
    gemini_version: str | None
    acp_supported: bool
    auth_valid: bool
    jobs_dir_writable: bool
    cwd_valid: bool
    errors: list[str]
    warnings: list[str]
    env_fingerprint: str | None
```

Auth validation: spawn `gemini --acp` with no TTY, send `initialize`, verify handshake completes without login prompt within timeout, then kill. Cache successful result per `cwd+env` fingerprint for 30-60 seconds.

### Preflight error codes

- `preflight_not_found` — gemini not in PATH
- `preflight_version` — ACP flag not supported
- `preflight_auth` — non-interactive auth failed
- `preflight_jobs_dir` — jobs directory not writable
- `preflight_cwd` — cwd invalid

### Runtime error codes

- `worker_spawn_failed`
- `handshake_timeout`
- `session_load_failed`
- `prompt_send_failed`
- `runtime_exception`
- `cancel_timeout`

## Node Plugin Changes

### What stays
- Command `.md` files — same slash commands, same UX
- Skills and agent definitions

### What changes
- `gemini-companion.mjs` — calls Python instead of spawning `gemini` directly
- `render.mjs` — reads JSON from Python, formats for Claude
- `job-control.mjs` — simplified to call Python `status`/`result`/`cancel`

### What's removed
- `gemini.mjs`: `runGeminiRaw()`, `runGeminiPrompt()`, `runGeminiJSON()` — replaced by `callGeminiAcp()`
- `process.mjs` — process management moves to Python supervisor
- All direct `gemini` CLI spawning from Node

### Node calling convention

Non-streaming:
```javascript
async function callGeminiAcp(subcommand, args = []) {
  // spawn python3 gemini-acp.py <subcommand> [...args]
  // collect stdout, parse single JSON envelope
  // share parser path with streaming reader
}
```

Streaming:
```javascript
async function* streamGeminiAcp(subcommand, args = []) {
  // spawn python3 gemini-acp.py <subcommand> --stream [...args]
  // read JSONL lines, yield events until terminal envelope
  // share parser path with non-streaming reader
}
```

Both share one JSON parser path underneath.

## File Layout

```
gemini/
  .claude-plugin/
    plugin.json
  commands/
    ask.md
    task.md
    review.md
    ui-review.md
    ui-design.md
    setup.md
    status.md
    result.md
    cancel.md
    logs.md
  skills/
    gemini-result-handling/SKILL.md
    gemini-ux-advisor/SKILL.md
  scripts/
    gemini-companion.mjs        — Node entry point (thin adapter)
    gemini-acp.py               — Python ACP runtime entry point
    node/
      args.mjs                  — CLI arg parsing
      render.mjs                — Format JSON for Claude
      job-control.mjs           — Calls Python status/result/cancel
      workspace.mjs             — cwd resolution
      state.mjs                 — tracked jobs UI state
    py/
      __init__.py
      transport.py              — AgentTransport ABC
      acp_runtime.py            — GeminiAcpTransport (SDK impl)
      preflight.py              — Auth/env checks with caching
      job_model.py              — Job record, persistence, locking
      events.py                 — Event normalization, JSONL append
      schemas.py                — Envelopes, enums, status constants, typed models
      supervisor.py             — Foreground/background orchestration

Storage (runtime, not in repo):
  ~/.gemini-acp/jobs/
    <job-id>/
      job.json
      events.jsonl
      result.json
```

## Model Aliases

```python
MODEL_ALIASES = {
    "pro": "gemini-3.1-pro-preview",
    "flash": "gemini-3-flash-preview",
    "25pro": "gemini-2.5-pro",
    "25flash": "gemini-2.5-flash",
    "lite": "gemini-2.5-flash-lite",
}
```

Resolved Python-side. Model selection via ACP `unstable_setSessionModel` is treated as an optional capability — failure is non-fatal.

## Known Risks

1. **Subprocess auth**: Gemini CLI in ACP mode may prompt for interactive login instead of reusing cached credentials. Mitigated by preflight auth check that validates non-interactive handshake.
2. **Token accounting**: Gemini ACP usage metadata may be inconsistent or absent. Mitigated by making `tokens` nullable.
3. **ACP event shape drift**: ACP protocol is evolving. Mitigated by preserving unknown events with `raw_event_type` and using SDK-generated models.
4. **Model configuration quirks**: `unstable_setSessionModel` may behave unexpectedly. Mitigated by treating model selection as non-fatal optional capability.

## Session Rules

- Fresh ACP session per command (default)
- `--resume <job-id>` loads session ID from job metadata, creates new job with `parent_job_id`
- No implicit session reuse across commands
- Resume valid on `ask` and `task` only
