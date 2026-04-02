"""Warm pool daemon — keeps a gemini --acp process alive between calls.

Architecture:
  - One daemon process holds one initialized gemini --acp subprocess
  - Listens on Unix socket at ~/.gemini-acp/pool.sock
  - Clients send JSONL requests, daemon streams JSONL responses
  - After each request, the ACP process stays alive for the next call
  - Auto-shuts down after IDLE_TIMEOUT_S with no requests

Protocol (over Unix socket):
  Client -> Daemon:  {"action":"prompt","command":"ask","prompt":"...","model":null,"session_id":null}
  Daemon -> Client:  {"type":"event","event":"session_started",...}  (JSONL stream)
  Daemon -> Client:  {"type":"event","event":"text_delta",...}
  Daemon -> Client:  {"type":"result","terminal":true,"ok":true,...}  (final)

  Client -> Daemon:  {"action":"ping"}
  Daemon -> Client:  {"type":"pong","alive":true}

  Client -> Daemon:  {"action":"shutdown"}
  Daemon -> Client:  {"type":"shutdown","ok":true}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
import sys
import time
from pathlib import Path
from typing import Optional

from . import JOBS_DIR, VERSION
from .acp_runtime import GeminiAcpTransport, GeminiAcpClient
from .schemas import (
    EventRecord, EventSource, ErrorCode, SuccessEnvelope,
    ErrorEnvelope, SCHEMA_VERSION, resolve_model_alias,
)
from .job_model import now_iso

log = logging.getLogger("gemini-pool")

POOL_DIR = Path.home() / ".gemini-acp"
SOCKET_PATH = POOL_DIR / "pool.sock"
PID_PATH = POOL_DIR / "pool.pid"
IDLE_TIMEOUT_S = 1800  # 30 minutes


class PoolDaemon:
    """Manages a warm gemini --acp process and serves requests via Unix socket."""

    def __init__(self):
        self.transport: Optional[GeminiAcpTransport] = None
        self.last_activity = time.monotonic()
        self._server = None
        self._running = False

    async def ensure_transport(self) -> GeminiAcpTransport:
        """Get or create a warm transport with completed ACP handshake."""
        if self.transport and self.transport.is_alive():
            return self.transport

        # Cold start a new one
        log.info("Spawning new gemini --acp process...")
        t = GeminiAcpTransport(job_id="pool-warm")
        await t.spawn(cwd=str(Path.cwd()), env=dict(os.environ))
        await t.initialize(timeout_s=30.0)
        log.info("ACP handshake complete — process warm")
        self.transport = t
        return t

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle one client connection."""
        self.last_activity = time.monotonic()
        try:
            data = await asyncio.wait_for(reader.readline(), timeout=10.0)
            if not data:
                return
            request = json.loads(data.decode().strip())
            action = request.get("action")

            if action == "ping":
                alive = self.transport is not None and self.transport.is_alive()
                writer.write(json.dumps({"type": "pong", "alive": alive}).encode() + b"\n")
                await writer.drain()
                return

            if action == "shutdown":
                writer.write(json.dumps({"type": "shutdown", "ok": True}).encode() + b"\n")
                await writer.drain()
                self._running = False
                return

            if action == "prompt":
                await self._handle_prompt(request, writer)
                return

            writer.write(json.dumps({"type": "error", "error": f"unknown action: {action}"}).encode() + b"\n")
            await writer.drain()

        except Exception as e:
            try:
                writer.write(json.dumps({"type": "error", "error": str(e)}).encode() + b"\n")
                await writer.drain()
            except Exception:
                pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _handle_prompt(self, request: dict, writer: asyncio.StreamWriter):
        """Handle a prompt request — create session, run prompt, stream events."""
        command = request.get("command", "ask")
        prompt = request.get("prompt", "")
        model = resolve_model_alias(request.get("model"))
        resume_session_id = request.get("session_id")
        job_id = request.get("job_id", "pool-req")

        try:
            transport = await self.ensure_transport()

            # Create or load session
            if resume_session_id:
                session_id = await transport.load_session(resume_session_id)
            else:
                session_id = await transport.new_session()

            # Emit session event
            ev = {"type": "event", "event": "session_started", "session_id": session_id,
                  "schema_version": SCHEMA_VERSION}
            writer.write(json.dumps(ev).encode() + b"\n")
            await writer.drain()

            # Set model (non-fatal)
            if model:
                try:
                    await transport._conn.set_session_model(model_id=model, session_id=session_id)
                except Exception:
                    pass

            # Reset client state for fresh request
            transport.client._text_chunks.clear()
            transport.client._events.clear()
            transport.client._prompt_done = False
            transport.client._event_signal.clear()

            # Send prompt
            await transport.send_prompt(prompt, session_id=session_id)

            # Stream events
            tokens = None
            async for event_record in transport.stream_events():
                ev_json = event_record.to_json()
                writer.write(ev_json.encode() + b"\n")
                await writer.drain()
                if event_record.event == "usage_update" and event_record.data:
                    tokens = event_record.data

            # Final result
            text = transport.client.get_assembled_text()

            # Close session (but keep process alive!)
            try:
                await transport._conn.close_session(session_id)
            except Exception:
                pass

            result = {
                "type": "result",
                "terminal": True,
                "schema_version": SCHEMA_VERSION,
                "ok": True,
                "command": command,
                "job_id": job_id,
                "session_id": session_id,
                "text": text,
                "tokens": tokens,
                "model": model,
            }
            writer.write(json.dumps(result).encode() + b"\n")
            await writer.drain()

        except Exception as e:
            # If transport died, clear it so next request gets a fresh one
            if self.transport and not self.transport.is_alive():
                self.transport = None

            result = {
                "type": "result",
                "terminal": True,
                "schema_version": SCHEMA_VERSION,
                "ok": False,
                "error": str(e) or repr(e),
                "error_code": "pool_error",
            }
            writer.write(json.dumps(result).encode() + b"\n")
            await writer.drain()

    async def run(self):
        """Start the daemon — listen on Unix socket, serve until idle timeout."""
        POOL_DIR.mkdir(parents=True, exist_ok=True)

        # Clean stale socket
        if SOCKET_PATH.exists():
            SOCKET_PATH.unlink()

        # Pre-warm the transport
        try:
            await self.ensure_transport()
        except Exception as e:
            log.error(f"Failed to warm transport: {e}")
            sys.exit(1)

        self._server = await asyncio.start_unix_server(
            self.handle_client, path=str(SOCKET_PATH)
        )
        os.chmod(str(SOCKET_PATH), 0o600)

        # Write PID file
        PID_PATH.write_text(str(os.getpid()))

        self._running = True
        log.info(f"Pool daemon listening on {SOCKET_PATH} (PID {os.getpid()})")

        try:
            while self._running:
                await asyncio.sleep(5.0)
                idle = time.monotonic() - self.last_activity
                if idle > IDLE_TIMEOUT_S:
                    log.info(f"Idle for {idle:.0f}s — shutting down")
                    break
        finally:
            self._server.close()
            await self._server.wait_closed()
            if self.transport:
                await self.transport.close()
            if SOCKET_PATH.exists():
                SOCKET_PATH.unlink()
            if PID_PATH.exists():
                PID_PATH.unlink()
            log.info("Pool daemon stopped")


# ---------------------------------------------------------------------------
# Client helper — used by supervisor to talk to the pool
# ---------------------------------------------------------------------------

def is_pool_alive() -> bool:
    """Check if the pool daemon is running and responsive."""
    if not SOCKET_PATH.exists():
        return False
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        sock.connect(str(SOCKET_PATH))
        sock.sendall(json.dumps({"action": "ping"}).encode() + b"\n")
        data = sock.recv(4096)
        sock.close()
        resp = json.loads(data.decode().strip())
        return resp.get("alive", False)
    except Exception:
        return False


def start_pool_daemon() -> bool:
    """Start the pool daemon in the background. Returns True if started."""
    if is_pool_alive():
        return True
    import subprocess
    script = str(Path(__file__).resolve().parent.parent / "gemini-acp.py")
    proc = subprocess.Popen(
        [sys.executable, script, "pool-start"],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Wait a bit for it to start
    for _ in range(40):  # up to 20s
        time.sleep(0.5)
        if is_pool_alive():
            return True
    return False


def stop_pool_daemon() -> bool:
    """Stop the pool daemon."""
    if not SOCKET_PATH.exists():
        return True
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(5.0)
        sock.connect(str(SOCKET_PATH))
        sock.sendall(json.dumps({"action": "shutdown"}).encode() + b"\n")
        sock.recv(4096)
        sock.close()
        return True
    except Exception:
        # Force kill via PID
        if PID_PATH.exists():
            try:
                pid = int(PID_PATH.read_text().strip())
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
        return True


async def pool_prompt(
    command: str,
    prompt: str,
    job_id: str = "pool-req",
    model: Optional[str] = None,
    session_id: Optional[str] = None,
) -> tuple[list[dict], dict]:
    """Send a prompt to the pool daemon. Returns (events, result)."""
    reader, writer = await asyncio.open_unix_connection(str(SOCKET_PATH))

    request = {
        "action": "prompt",
        "command": command,
        "prompt": prompt,
        "job_id": job_id,
        "model": model,
        "session_id": session_id,
    }
    writer.write(json.dumps(request).encode() + b"\n")
    await writer.drain()

    events = []
    result = None

    while True:
        line = await asyncio.wait_for(reader.readline(), timeout=300.0)
        if not line:
            break
        data = json.loads(line.decode().strip())
        if data.get("terminal"):
            result = data
            break
        events.append(data)

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass

    return events, result or {"ok": False, "error": "no result from pool"}
