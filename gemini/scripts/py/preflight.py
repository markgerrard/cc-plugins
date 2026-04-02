# scripts/py/preflight.py
"""Preflight checks — validate environment before any ACP operation."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from . import JOBS_DIR
from .schemas import ErrorCode

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache: keyed by (cwd, env_fingerprint) → (monotonic_time, PreflightResult)
# ---------------------------------------------------------------------------
_CACHE: dict[tuple[str, str], tuple[float, "PreflightResult"]] = {}
_CACHE_TTL_S = 60.0


# ---------------------------------------------------------------------------
# PreflightResult
# ---------------------------------------------------------------------------

@dataclass
class PreflightResult:
    gemini_found: bool = False
    gemini_version: Optional[str] = None
    acp_supported: bool = False
    auth_valid: bool = False
    jobs_dir_writable: bool = False
    cwd_valid: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    env_fingerprint: Optional[str] = None

    @property
    def ok(self) -> bool:
        return all([
            self.gemini_found,
            self.acp_supported,
            self.auth_valid,
            self.jobs_dir_writable,
            self.cwd_valid,
        ])

    @property
    def first_error_code(self) -> Optional[str]:
        if not self.gemini_found:
            return ErrorCode.PREFLIGHT_NOT_FOUND.value
        if not self.acp_supported:
            return ErrorCode.PREFLIGHT_VERSION.value
        if not self.jobs_dir_writable:
            return ErrorCode.PREFLIGHT_JOBS_DIR.value
        if not self.cwd_valid:
            return ErrorCode.PREFLIGHT_CWD.value
        if not self.auth_valid:
            return ErrorCode.PREFLIGHT_AUTH.value
        return None


# ---------------------------------------------------------------------------
# Minimal ACP client for preflight (stub — we only need the handshake)
# ---------------------------------------------------------------------------

class PreflightClient:
    """Minimal ACP Client implementation for the preflight auth check."""

    def on_connect(self, conn: Any) -> None:
        pass

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        pass

    async def request_permission(self, session_id: str, tool_call: Any, options: Any, **kwargs: Any) -> Any:
        from acp.schema import AllowedOutcome, RequestPermissionResponse
        return RequestPermissionResponse(
            outcome=AllowedOutcome(outcome="selected", option_id="allow_once")
        )

    def write_text_file(self, *args: Any, **kwargs: Any) -> None:
        return None

    def read_text_file(self, *args: Any, **kwargs: Any) -> None:
        return None

    def create_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def terminal_output(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def release_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def wait_for_terminal_exit(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def kill_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def ext_method(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError

    def ext_notification(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def _check_gemini_found(result: PreflightResult) -> bool:
    """Check 1: gemini binary is on PATH."""
    gemini_path = shutil.which("gemini")
    if gemini_path is None:
        result.errors.append("gemini not found on PATH")
        return False
    result.gemini_found = True
    return True


def _check_acp_supported(result: PreflightResult) -> bool:
    """Check 2: gemini --help mentions --acp flag."""
    try:
        proc = subprocess.run(
            ["gemini", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        # --help may write to stdout or stderr depending on version
        combined = proc.stdout + proc.stderr

        # Capture version if present (e.g. "gemini v1.2.3" or "version 1.2.3")
        for line in combined.splitlines():
            lower = line.lower()
            if "version" in lower or line.strip().startswith("v"):
                import re
                m = re.search(r"\d+\.\d+[\.\d]*", line)
                if m:
                    result.gemini_version = m.group(0)
                    break

        if "--acp" not in combined:
            result.errors.append("gemini --help does not mention --acp; upgrade gemini CLI")
            return False
    except subprocess.TimeoutExpired:
        result.errors.append("gemini --help timed out")
        return False
    except Exception as exc:
        result.errors.append(f"gemini --help failed: {exc}")
        return False

    result.acp_supported = True
    return True


def _check_jobs_dir_writable(result: PreflightResult) -> bool:
    """Check 3: JOBS_DIR exists (or can be created) and is writable."""
    try:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        probe = JOBS_DIR / f".preflight_probe_{os.getpid()}"
        probe.write_text("ok")
        probe.unlink()
    except Exception as exc:
        result.errors.append(f"jobs dir not writable ({JOBS_DIR}): {exc}")
        return False

    result.jobs_dir_writable = True
    return True


def _check_cwd_valid(result: PreflightResult, cwd: str) -> bool:
    """Check 4: cwd exists as a directory."""
    if not Path(cwd).is_dir():
        result.errors.append(f"cwd is not a valid directory: {cwd!r}")
        return False
    result.cwd_valid = True
    return True


async def _check_auth(result: PreflightResult, cwd: str, handshake_timeout_s: float) -> bool:
    """Check 5: spawn gemini --acp, send ACP initialize, verify handshake."""
    try:
        from acp import PROTOCOL_VERSION, connect_to_agent
        from acp.transports import spawn_stdio_transport
        from acp.schema import ClientCapabilities, Implementation
        from . import VERSION
    except ImportError as exc:
        result.errors.append(f"ACP SDK not importable: {exc}")
        return False

    client = PreflightClient()
    process = None
    transport_cm = None

    try:
        transport_cm = spawn_stdio_transport("gemini", "--acp", env=dict(os.environ), cwd=cwd)
        reader, writer, process = await transport_cm.__aenter__()

        conn = connect_to_agent(client, writer, reader, use_unstable_protocol=True)

        async with asyncio.timeout(handshake_timeout_s):
            await conn.initialize(
                protocol_version=PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(),
                client_info=Implementation(
                    name="gemini-preflight",
                    title="Gemini Preflight Check",
                    version=VERSION,
                ),
            )

        # Handshake succeeded — close cleanly
        try:
            await conn.close()
        except Exception:
            pass

    except asyncio.TimeoutError:
        result.errors.append(
            f"ACP handshake timed out after {handshake_timeout_s}s "
            "(login prompt or slow startup?)"
        )
        return False
    except Exception as exc:
        result.errors.append(f"ACP auth check failed: {exc}")
        return False
    finally:
        # Always clean up transport and process
        if transport_cm is not None:
            try:
                await transport_cm.__aexit__(None, None, None)
            except Exception:
                pass
        if process is not None and getattr(process, "returncode", None) is None:
            try:
                pgid = os.getpgid(process.pid)
                os.killpg(pgid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            try:
                await asyncio.wait_for(process.wait(), timeout=3.0)
            except (asyncio.TimeoutError, Exception):
                try:
                    process.kill()
                except Exception:
                    pass

    result.auth_valid = True
    return True


# ---------------------------------------------------------------------------
# env_fingerprint
# ---------------------------------------------------------------------------

def _make_env_fingerprint(cwd: str) -> str:
    """SHA-256 of cwd + HOME + PATH + NODE_PATH (no secrets)."""
    parts = [
        cwd,
        os.environ.get("HOME", ""),
        os.environ.get("PATH", ""),
        os.environ.get("NODE_PATH", ""),
    ]
    raw = "\0".join(parts).encode()
    return hashlib.sha256(raw).hexdigest()


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def run_preflight(cwd: str, handshake_timeout_s: float = 10.0) -> PreflightResult:
    """Run all preflight checks in order. Returns a PreflightResult.

    Results are cached per (cwd, env_fingerprint) for 60 seconds.
    """
    fingerprint = _make_env_fingerprint(cwd)
    cache_key = (cwd, fingerprint)

    # Check cache
    cached = _CACHE.get(cache_key)
    if cached is not None:
        cached_at, cached_result = cached
        if time.monotonic() - cached_at < _CACHE_TTL_S:
            log.debug("preflight cache hit for cwd=%s", cwd)
            return cached_result

    result = PreflightResult(env_fingerprint=fingerprint)

    # Checks 1-4 are synchronous and fast; check 5 is async and expensive.
    if not _check_gemini_found(result):
        return result

    if not _check_acp_supported(result):
        return result

    if not _check_jobs_dir_writable(result):
        return result

    if not _check_cwd_valid(result, cwd):
        return result

    # Check 5: auth (expensive — spawn subprocess)
    await _check_auth(result, cwd, handshake_timeout_s)

    # Cache only successful results (per spec)
    if result.ok:
        _CACHE[cache_key] = (time.monotonic(), result)

    return result
