#!/usr/bin/env python3
"""Gemini ACP CLI entry point.

Single entry point called by the Node plugin:
    python3 gemini-acp.py <subcommand> [args]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from py import JOBS_DIR
from py.schemas import SCHEMA_VERSION, ErrorEnvelope, RESUMABLE_COMMANDS, JobStatus
from py.preflight import run_preflight
from py.job_model import read_job, list_jobs_for_cwd, reconcile_stale, read_result
from py.events import read_events
from py.supervisor import run_foreground, launch_background, run_worker, cancel_job
from py.pool import PoolDaemon, is_pool_alive, start_pool_daemon, stop_pool_daemon


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gemini-acp",
        description="Gemini ACP CLI — Node plugin entry point",
    )
    parser.add_argument(
        "--cwd",
        default=None,
        help="Working directory (default: current directory)",
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")
    subparsers.required = True

    # ------------------------------------------------------------------
    # setup
    # ------------------------------------------------------------------
    subparsers.add_parser(
        "setup",
        help="Run preflight checks and print JSON diagnostic report",
    )

    # ------------------------------------------------------------------
    # Prompt commands: ask, task, review, ui-review, ui-design
    # ------------------------------------------------------------------
    _add_prompt_command(subparsers, "ask",       "Ask Gemini a question")
    _add_prompt_command(subparsers, "task",      "Run a task with Gemini")
    _add_prompt_command(subparsers, "review",    "Request a code review from Gemini")
    _add_prompt_command(subparsers, "ui-review", "Request a UI/UX review from Gemini")
    _add_prompt_command(subparsers, "ui-design", "Request a UI/UX design from Gemini")

    # ------------------------------------------------------------------
    # Job query commands: status, result, cancel, logs
    # ------------------------------------------------------------------
    for name, help_text in [
        ("status", "Show job status (or list all jobs for cwd)"),
        ("result", "Read the result of a completed job"),
        ("cancel", "Cancel a running job"),
        ("logs",   "Stream or print job event log"),
    ]:
        sub = subparsers.add_parser(name, help=help_text)
        sub.add_argument("--job", metavar="JOB_ID", default=None, help="Job ID")
        sub.add_argument(
            "--text",
            action="store_true",
            default=False,
            help="Output as plain text (logs only)",
        )

    # ------------------------------------------------------------------
    # worker-run (internal)
    # ------------------------------------------------------------------
    worker = subparsers.add_parser("worker-run", help="Internal: run background worker")
    worker.add_argument("--job", metavar="JOB_ID", required=True, help="Job ID to run")

    # pool-start / pool-stop (internal)
    subparsers.add_parser("pool-start", help="Start the warm pool daemon")
    subparsers.add_parser("pool-stop", help="Stop the warm pool daemon")
    subparsers.add_parser("pool-warm", help="Ensure pool is running (start if needed)")

    return parser


def _add_prompt_command(
    subparsers: argparse._SubParsersAction,
    name: str,
    help_text: str,
) -> None:
    sub = subparsers.add_parser(name, help=help_text)
    sub.add_argument(
        "prompt",
        nargs="*",
        metavar="PROMPT",
        help="Prompt text (positional, joined with spaces)",
    )
    sub.add_argument("--background", action="store_true", default=False,
                     help="Run in background (detached)")
    sub.add_argument("--stream", action="store_true", default=False,
                     help="Stream JSONL events to stdout")
    sub.add_argument("--model", default=None,
                     help="Model name or alias (e.g. pro, flash, 25pro)")
    sub.add_argument("--resume", metavar="JOB_ID", default=None,
                     help="Resume a previous job's session (ask/task only)")
    sub.add_argument("--text", action="store_true", default=False,
                     help="Output as plain text instead of JSON")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_cwd(args: argparse.Namespace) -> str:
    import os
    cwd = getattr(args, "cwd", None) or os.getcwd()
    return str(Path(cwd).resolve())


def _error_exit(command: str, error: str, error_code: str = "runtime_exception",
                exit_code: int = 1) -> None:
    env = ErrorEnvelope(
        command=command,
        error=error,
        error_code=error_code,
        exit_code=exit_code,
    )
    print(env.to_json(), flush=True)
    sys.exit(exit_code)


# ---------------------------------------------------------------------------
# Dispatch handlers
# ---------------------------------------------------------------------------

async def _handle_setup(args: argparse.Namespace) -> None:
    cwd = _resolve_cwd(args)
    result = await run_preflight(cwd)
    report = {
        "schema_version": SCHEMA_VERSION,
        "ok": result.ok,
        "command": "setup",
        "gemini_found": result.gemini_found,
        "gemini_version": result.gemini_version,
        "acp_supported": result.acp_supported,
        "auth_valid": result.auth_valid,
        "jobs_dir_writable": result.jobs_dir_writable,
        "cwd_valid": result.cwd_valid,
        "errors": result.errors,
        "warnings": result.warnings,
        "env_fingerprint": result.env_fingerprint,
    }
    print(json.dumps(report), flush=True)


async def _handle_prompt(args: argparse.Namespace) -> None:
    command = args.command
    cwd = _resolve_cwd(args)

    # Join positional args into prompt
    prompt_parts = getattr(args, "prompt", [])
    if not prompt_parts:
        _error_exit(command, "prompt is required", "missing_prompt")

    prompt = " ".join(prompt_parts)

    # Validate --resume only for resumable commands
    resume = getattr(args, "resume", None)
    if resume and command not in RESUMABLE_COMMANDS:
        _error_exit(
            command,
            f"--resume is only valid for: {', '.join(sorted(RESUMABLE_COMMANDS))}",
            "invalid_argument",
        )

    # Validate --background + --stream is invalid
    if args.background and args.stream:
        _error_exit(
            command,
            "--background and --stream cannot be used together",
            "invalid_argument",
        )

    if args.background:
        launch_background(
            command=command,
            prompt=prompt,
            cwd=cwd,
            model=args.model,
            resume_job_id=resume,
        )
    else:
        await run_foreground(
            command=command,
            prompt=prompt,
            cwd=cwd,
            model=args.model,
            resume_job_id=resume,
            stream=args.stream,
        )


async def _handle_status(args: argparse.Namespace) -> None:
    cwd = _resolve_cwd(args)
    job_id = getattr(args, "job", None)

    if job_id:
        job = read_job(job_id)
        if job is None:
            _error_exit("status", f"job not found: {job_id}", "not_found")
        job = reconcile_stale(job)
        print(json.dumps({
            "schema_version": SCHEMA_VERSION,
            "ok": True,
            "command": "status",
            "job": job.to_dict(),
        }), flush=True)
    else:
        jobs = list_jobs_for_cwd(cwd)
        jobs = [reconcile_stale(j) for j in jobs]
        print(json.dumps({
            "schema_version": SCHEMA_VERSION,
            "ok": True,
            "command": "status",
            "cwd": cwd,
            "jobs": [j.to_dict() for j in jobs],
        }), flush=True)


async def _handle_result(args: argparse.Namespace) -> None:
    cwd = _resolve_cwd(args)
    job_id = getattr(args, "job", None)

    if job_id:
        result = read_result(job_id)
        if result is None:
            _error_exit("result", f"result not found for job: {job_id}", "not_found")
        print(json.dumps(result), flush=True)
    else:
        # Find most recent terminal job with result_available=True in cwd
        jobs = list_jobs_for_cwd(cwd)
        candidates = [
            j for j in jobs
            if j.result_available and JobStatus(j.status).is_terminal
        ]
        if len(candidates) == 0:
            _error_exit(
                "result",
                "no completed jobs with results found in cwd",
                "not_found",
            )
        elif len(candidates) > 1:
            _error_exit(
                "result",
                f"multiple completed jobs found; specify --job (found: {', '.join(j.job_id for j in candidates[:5])})",
                "ambiguous",
            )
        else:
            result = read_result(candidates[0].job_id)
            if result is None:
                _error_exit("result", "result file missing", "not_found")
            print(json.dumps(result), flush=True)


async def _handle_cancel(args: argparse.Namespace) -> None:
    cwd = _resolve_cwd(args)
    job_id = getattr(args, "job", None)

    if job_id:
        result_json = await cancel_job(job_id)
        print(result_json, flush=True)
    else:
        # Find active (non-terminal) jobs in cwd
        jobs = list_jobs_for_cwd(cwd)
        active = [j for j in jobs if not JobStatus(j.status).is_terminal]
        if len(active) == 0:
            _error_exit("cancel", "no active jobs found in cwd", "not_found")
        elif len(active) > 1:
            _error_exit(
                "cancel",
                f"multiple active jobs found; specify --job (found: {', '.join(j.job_id for j in active[:5])})",
                "ambiguous",
            )
        else:
            result_json = await cancel_job(active[0].job_id)
            print(result_json, flush=True)


async def _handle_logs(args: argparse.Namespace) -> None:
    cwd = _resolve_cwd(args)
    job_id = getattr(args, "job", None)

    if not job_id:
        # Use most recent job for cwd
        jobs = list_jobs_for_cwd(cwd)
        if not jobs:
            _error_exit("logs", "no jobs found in cwd", "not_found")
        job_id = jobs[0].job_id  # already sorted newest-first

    events = read_events(job_id)
    use_text = getattr(args, "text", False)

    if use_text:
        for ev in events:
            # Extract human-readable text: prefer data.text, else event name
            data = ev.get("data") or {}
            line = data.get("text") or data.get("content") or ev.get("event", "")
            if line:
                print(line, flush=True)
    else:
        for ev in events:
            print(json.dumps(ev), flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

PROMPT_COMMANDS = {"ask", "task", "review", "ui-review", "ui-design"}


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    command = args.command

    if command == "setup":
        await _handle_setup(args)

    elif command in PROMPT_COMMANDS:
        await _handle_prompt(args)

    elif command == "status":
        await _handle_status(args)

    elif command == "result":
        await _handle_result(args)

    elif command == "cancel":
        await _handle_cancel(args)

    elif command == "logs":
        await _handle_logs(args)

    elif command == "worker-run":
        await run_worker(args.job)

    elif command == "pool-start":
        daemon = PoolDaemon()
        await daemon.run()

    elif command == "pool-stop":
        stop_pool_daemon()
        print(json.dumps({"ok": True, "message": "pool stopped"}))

    elif command == "pool-warm":
        if is_pool_alive():
            print(json.dumps({"ok": True, "message": "pool already running"}))
        elif start_pool_daemon():
            print(json.dumps({"ok": True, "message": "pool started"}))
        else:
            print(json.dumps({"ok": False, "error": "failed to start pool"}))
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
