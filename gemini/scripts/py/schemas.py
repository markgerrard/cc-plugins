"""Envelopes, enums, status constants, typed models."""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional

SCHEMA_VERSION = 1


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLING = "cancelling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    STALE = "stale"

    @property
    def is_terminal(self) -> bool:
        return self in (
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.STALE,
        )


class ErrorCode(str, Enum):
    PREFLIGHT_NOT_FOUND = "preflight_not_found"
    PREFLIGHT_VERSION = "preflight_version"
    PREFLIGHT_AUTH = "preflight_auth"
    PREFLIGHT_JOBS_DIR = "preflight_jobs_dir"
    PREFLIGHT_CWD = "preflight_cwd"
    WORKER_SPAWN_FAILED = "worker_spawn_failed"
    HANDSHAKE_TIMEOUT = "handshake_timeout"
    SESSION_LOAD_FAILED = "session_load_failed"
    PROMPT_SEND_FAILED = "prompt_send_failed"
    RUNTIME_EXCEPTION = "runtime_exception"
    CANCEL_TIMEOUT = "cancel_timeout"


class EventSource(str, Enum):
    AGENT = "agent"
    TOOL = "tool"
    RUNTIME = "runtime"
    SUPERVISOR = "supervisor"


MODEL_ALIASES = {
    "pro": "gemini-3.1-pro-preview",
    "flash": "gemini-3-flash-preview",
    "25pro": "gemini-2.5-pro",
    "25flash": "gemini-2.5-flash",
    "lite": "gemini-2.5-flash-lite",
}

RESUMABLE_COMMANDS = {"ask", "task"}


def resolve_model_alias(model: Optional[str]) -> Optional[str]:
    if not model:
        return None
    return MODEL_ALIASES.get(model.lower(), model)


@dataclass
class SuccessEnvelope:
    command: str
    job_id: str
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    model: Optional[str] = None
    status: str = "completed"
    text: str = ""
    tokens: Optional[dict] = None
    files_changed: Optional[list] = None
    duration_ms: int = 0
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    warnings: list = field(default_factory=list)
    result_available: bool = True
    exit_code: int = 0

    def to_json(self) -> str:
        d = {"schema_version": SCHEMA_VERSION, "ok": True}
        d.update({k: v for k, v in asdict(self).items()})
        return json.dumps(d)


@dataclass
class ErrorEnvelope:
    command: str
    error: str
    error_code: str
    exit_code: int = 1

    def to_json(self) -> str:
        d = {"schema_version": SCHEMA_VERSION, "ok": False}
        d.update({k: v for k, v in asdict(self).items()})
        return json.dumps(d)


@dataclass
class EventRecord:
    event: str
    source: str
    job_id: str
    session_id: Optional[str] = None
    timestamp: Optional[str] = None
    data: Optional[dict] = None
    raw_event_type: Optional[str] = None

    def to_json(self) -> str:
        d = {
            "schema_version": SCHEMA_VERSION,
            "type": "event",
        }
        d.update({k: v for k, v in asdict(self).items() if v is not None})
        return json.dumps(d)


@dataclass
class JobRecord:
    job_id: str
    command: str
    prompt: str
    cwd: str
    model: Optional[str] = None
    parent_job_id: Optional[str] = None
    session_id: Optional[str] = None
    status: str = JobStatus.QUEUED.value
    error_code: Optional[str] = None
    error: Optional[str] = None
    pid: Optional[int] = None
    pgid: Optional[int] = None
    mode: str = "foreground"
    output_mode: str = "json"
    env_fingerprint: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    last_updated_at: Optional[str] = None
    ended_at: Optional[str] = None
    result_available: bool = False
    exit_code: Optional[int] = None

    def to_dict(self) -> dict:
        d = {"schema_version": SCHEMA_VERSION}
        d.update(asdict(self))
        return d
