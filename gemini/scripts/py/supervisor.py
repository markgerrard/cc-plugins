"""Supervisor — foreground and background orchestration."""
from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .schemas import (
    ErrorCode,
    ErrorEnvelope,
    EventSource,
    JobStatus,
    SuccessEnvelope,
    resolve_model_alias,
    SCHEMA_VERSION,
    EventRecord,
)
from .job_model import (
    JobRecord,
    create_job,
    generate_job_id,
    now_iso,
    read_job,
    update_job,
    write_result,
)
from .events import append_event
from .preflight import run_preflight
from .acp_runtime import GeminiAcpTransport


# ---------------------------------------------------------------------------
# Foreground execution
# ---------------------------------------------------------------------------

async def run_foreground(
    command: str,
    prompt: str,
    cwd: str,
    model: Optional[str] = None,
    resume_job_id: Optional[str] = None,
    stream: bool = False,
    output_mode: str = "json",
    existing_job_id: Optional[str] = None,
) -> None:
    """Run a prompt synchronously, printing results to stdout."""

    # 1. Resolve model alias
    model = resolve_model_alias(model)

    # 2. Preflight (skip if existing_job_id — worker already ran preflight)
    if not existing_job_id:
        preflight = await run_preflight(cwd)
        if not preflight.ok:
            env = ErrorEnvelope(
                command=command,
                error=preflight.errors[0] if preflight.errors else "preflight failed",
                error_code=preflight.first_error_code or ErrorCode.RUNTIME_EXCEPTION.value,
                exit_code=2,
            )
            print(env.to_json(), flush=True)
            sys.exit(2)

    # 3. Create or reuse job record
    if existing_job_id:
        job_id = existing_job_id
        existing = read_job(job_id)
        session_id = existing.session_id if existing else None
        parent_job_id = existing.parent_job_id if existing else None
    else:
        job_id = generate_job_id()
        parent_job_id = None
        session_id = None

        if resume_job_id:
            parent = read_job(resume_job_id)
            if parent is not None:
                session_id = parent.session_id
                parent_job_id = resume_job_id

        record = JobRecord(
            job_id=job_id,
            command=command,
            prompt=prompt,
            cwd=cwd,
            model=model,
            parent_job_id=parent_job_id,
            session_id=session_id,
            status=JobStatus.QUEUED.value,
            mode="foreground",
            output_mode=output_mode,
            env_fingerprint=preflight.env_fingerprint,
        )
        create_job(record)

    # 4. Create transport
    transport = GeminiAcpTransport(job_id=job_id)
    started_at: Optional[str] = None

    try:
        # Spawn transport
        await transport.spawn(cwd=cwd, env=dict(os.environ))

        # 5. Initialize
        await transport.initialize()
        started_at = now_iso()
        pid = transport._process.pid if transport._process else None
        pgid: Optional[int] = None
        if pid is not None:
            try:
                pgid = os.getpgid(pid)
            except (ProcessLookupError, OSError):
                pass
        update_job(job_id, status=JobStatus.RUNNING.value, pid=pid, pgid=pgid, started_at=started_at)

        # 6. Create or load session
        if session_id:
            session_id = await transport.load_session(session_id)
            event_name = "session_loaded"
        else:
            session_id = await transport.new_session()
            event_name = "session_started"

        update_job(job_id, session_id=session_id)

        # 7. Emit session event
        session_event = EventRecord(
            event=event_name,
            source=EventSource.SUPERVISOR.value,
            job_id=job_id,
            session_id=session_id,
            timestamp=now_iso(),
        )
        append_event(job_id, session_event)
        if stream:
            print(session_event.to_json(), flush=True)

        # 8. Set model (non-fatal)
        if model:
            try:
                await transport._conn.set_session_model(
                    session_id=session_id, model=model,
                )
            except Exception:
                pass

        # 9. Send prompt
        await transport.send_prompt(prompt, session_id=session_id)

        # 10. Stream events
        tokens: dict = {}
        async for er in transport.stream_events():
            append_event(job_id, er)
            if stream:
                print(er.to_json(), flush=True)
            # Capture usage tokens
            if er.event == "usage_update" and er.data:
                for field in ("input_tokens", "output_tokens", "total_tokens", "cost_usd"):
                    if field in er.data:
                        tokens[field] = er.data[field]

        # 11. Completion
        ended_at = now_iso()
        text = transport.client.get_assembled_text()
        duration_ms = 0
        if started_at:
            try:
                t0 = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
                duration_ms = int((t1 - t0).total_seconds() * 1000)
            except Exception:
                pass

        envelope = SuccessEnvelope(
            command=command,
            job_id=job_id,
            session_id=session_id,
            cwd=cwd,
            model=model,
            text=text,
            tokens=tokens if tokens else None,
            duration_ms=duration_ms,
            started_at=started_at,
            ended_at=ended_at,
        )
        update_job(
            job_id,
            status=JobStatus.COMPLETED.value,
            ended_at=ended_at,
            result_available=True,
            exit_code=0,
        )
        write_result(job_id, envelope.to_json())

        if stream:
            # Terminal JSONL envelope
            print(envelope.to_json(), flush=True)
        else:
            print(envelope.to_json(), flush=True)

    except Exception as exc:
        # 12. Error handling
        ended_at = now_iso()
        import traceback
        error_msg = str(exc) or repr(exc) or "unknown error"
        print(traceback.format_exc(), file=sys.stderr)
        err_envelope = ErrorEnvelope(
            command=command,
            error=error_msg,
            error_code=ErrorCode.RUNTIME_EXCEPTION.value,
            exit_code=1,
        )
        update_job(
            job_id,
            status=JobStatus.FAILED.value,
            error=error_msg,
            error_code=ErrorCode.RUNTIME_EXCEPTION.value,
            ended_at=ended_at,
            result_available=True,
            exit_code=1,
        )
        write_result(job_id, err_envelope.to_json())
        print(err_envelope.to_json(), flush=True)
        sys.exit(1)

    finally:
        # 13. Cleanup
        await transport.close()


# ---------------------------------------------------------------------------
# Background launch
# ---------------------------------------------------------------------------

def launch_background(
    command: str,
    prompt: str,
    cwd: str,
    model: Optional[str] = None,
    resume_job_id: Optional[str] = None,
    output_mode: str = "json",
) -> None:
    """Launch a detached background worker process."""

    # 1. Resolve model alias
    model = resolve_model_alias(model)

    # 2. Create job record
    job_id = generate_job_id()
    parent_job_id: Optional[str] = None
    session_id: Optional[str] = None

    if resume_job_id:
        parent = read_job(resume_job_id)
        if parent is not None:
            session_id = parent.session_id
            parent_job_id = resume_job_id

    record = JobRecord(
        job_id=job_id,
        command=command,
        prompt=prompt,
        cwd=cwd,
        model=model,
        parent_job_id=parent_job_id,
        session_id=session_id,
        status=JobStatus.QUEUED.value,
        mode="background",
        output_mode=output_mode,
    )
    create_job(record)

    # 4. Spawn detached worker
    script_path = Path(__file__).resolve().parent.parent / "gemini-acp.py"
    proc = subprocess.Popen(
        [sys.executable, str(script_path), "worker-run", "--job", job_id],
        cwd=cwd,
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # 5. Update job with pid/pgid
    pid = proc.pid
    pgid: Optional[int] = None
    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, OSError):
        pass
    update_job(job_id, pid=pid, pgid=pgid)

    # 6. Print envelope
    envelope = {
        "schema_version": SCHEMA_VERSION,
        "ok": True,
        "command": command,
        "job_id": job_id,
        "status": "queued",
        "pid": pid,
        "cwd": cwd,
    }
    print(json.dumps(envelope), flush=True)


# ---------------------------------------------------------------------------
# Background worker entry point
# ---------------------------------------------------------------------------

async def run_worker(job_id: str) -> None:
    """Called by the detached background worker process."""

    # 1. Read job record
    job = read_job(job_id)
    if job is None:
        sys.exit(1)

    # 2. Run preflight
    preflight = await run_preflight(job.cwd)
    if not preflight.ok:
        error_msg = preflight.errors[0] if preflight.errors else "preflight failed"
        error_code = preflight.first_error_code or ErrorCode.RUNTIME_EXCEPTION.value
        update_job(
            job_id,
            status=JobStatus.FAILED.value,
            error=error_msg,
            error_code=error_code,
            ended_at=now_iso(),
            result_available=True,
            exit_code=2,
        )
        err_envelope = ErrorEnvelope(
            command=job.command,
            error=error_msg,
            error_code=error_code,
            exit_code=2,
        )
        write_result(job_id, err_envelope.to_json())
        sys.exit(2)

    # 3. Redirect stdout to devnull (background — nobody reads it)
    original_stdout = sys.stdout
    try:
        sys.stdout = open(os.devnull, "w")

        # 4. Run foreground with the existing job ID
        try:
            await run_foreground(
                command=job.command,
                prompt=job.prompt,
                cwd=job.cwd,
                model=job.model,
                resume_job_id=job.parent_job_id,
                stream=False,
                output_mode=job.output_mode,
                existing_job_id=job_id,
            )
        except SystemExit:
            # run_foreground may sys.exit on failure — that's fine
            pass

    finally:
        # 6. Restore stdout
        if sys.stdout is not original_stdout:
            try:
                sys.stdout.close()
            except Exception:
                pass
        sys.stdout = original_stdout


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------

async def cancel_job(job_id: str) -> str:
    """Cancel a running job. Returns a JSON string."""

    # 1. Read job
    job = read_job(job_id)
    if job is None:
        return json.dumps({
            "schema_version": SCHEMA_VERSION,
            "ok": False,
            "error": f"job not found: {job_id}",
            "error_code": "not_found",
        })

    # 2. Already terminal?
    status = JobStatus(job.status)
    if status.is_terminal:
        return json.dumps({
            "schema_version": SCHEMA_VERSION,
            "ok": True,
            "job_id": job_id,
            "status": job.status,
            "message": "already finished",
        })

    # 3. Update to cancelling
    update_job(job_id, status=JobStatus.CANCELLING.value)

    # 4. Kill process
    if job.pgid:
        try:
            os.killpg(job.pgid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass

        # Wait up to 10s for process to die
        if job.pid:
            deadline = time.monotonic() + 10.0
            while time.monotonic() < deadline:
                try:
                    os.kill(job.pid, 0)
                except (ProcessLookupError, PermissionError):
                    break
                await asyncio.sleep(0.1)
            else:
                # Still alive — SIGKILL
                try:
                    os.killpg(job.pgid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    pass

    elif job.pid:
        try:
            os.kill(job.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass

    # 5. Update to cancelled
    ended_at = now_iso()
    update_job(
        job_id,
        status=JobStatus.CANCELLED.value,
        ended_at=ended_at,
        result_available=True,
        exit_code=3,
    )

    err_envelope = ErrorEnvelope(
        command=job.command,
        error="Cancelled by user",
        error_code="cancelled",
        exit_code=3,
    )
    write_result(job_id, err_envelope.to_json())

    # 6. Return success JSON
    return json.dumps({
        "schema_version": SCHEMA_VERSION,
        "ok": True,
        "job_id": job_id,
        "status": "cancelled",
        "message": "job cancelled",
    })
