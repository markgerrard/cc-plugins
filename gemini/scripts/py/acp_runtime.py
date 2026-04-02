# scripts/py/acp_runtime.py
"""GeminiAcpTransport — ACP SDK-backed transport for Gemini CLI."""
from __future__ import annotations

import asyncio
import logging
import os
import signal
from collections import deque
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from . import VERSION
from .schemas import EventRecord, EventSource
from .transport import AgentTransport, InitResult

from acp import PROTOCOL_VERSION, connect_to_agent
from acp.transports import spawn_stdio_transport
from acp.schema import (
    AllowedOutcome,
    ClientCapabilities,
    Implementation,
    RequestPermissionResponse,
    TextContentBlock,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ACP event type -> normalized event name
# ---------------------------------------------------------------------------
_EVENT_MAP = {
    "agent_message_chunk": "text_delta",
    "tool_call_start": "tool_use_start",
    "tool_call_end": "tool_use_end",
    "agent_thought_chunk": "agent_thought_chunk",
    "usage_update": "usage_update",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get(obj: Any, key: str) -> Any:
    """Resolve attribute or dict key."""
    if hasattr(obj, key):
        return getattr(obj, key)
    if isinstance(obj, dict):
        return obj.get(key)
    return None


# ---------------------------------------------------------------------------
# GeminiAcpClient — implements the ACP Client interface
# ---------------------------------------------------------------------------

class GeminiAcpClient:
    """ACP client that receives session_update notifications and queues EventRecords."""

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self._text_chunks: list[str] = []
        self._events: deque[EventRecord] = deque()
        self._event_signal: asyncio.Event = asyncio.Event()
        self._prompt_done: bool = False
        self._conn: Any = None
        self._input_tokens: Optional[int] = None
        self._output_tokens: Optional[int] = None
        self._total_tokens: Optional[int] = None
        self._cost_usd: Optional[float] = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def on_connect(self, conn: Any) -> None:
        log.debug("ACP connection established for job %s", self.job_id)
        self._conn = conn

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------

    async def session_update(
        self, session_id: str, update: Any, **kwargs: Any
    ) -> None:
        """Normalize an ACP session_update into an EventRecord and queue it."""
        # Determine the raw event type
        raw_type: Optional[str] = None
        if hasattr(update, "session_update"):
            raw_type = update.session_update
        elif isinstance(update, dict):
            raw_type = update.get("session_update") or update.get("type")

        normalized = _EVENT_MAP.get(raw_type or "", raw_type or "unknown")
        data: dict[str, Any] = {}

        if raw_type == "agent_message_chunk":
            text = self._extract_text(update)
            if text:
                self._text_chunks.append(text)
            data["text"] = text or ""

        elif raw_type == "usage_update":
            usage_data = _get(update, "usage")
            if usage_data is not None:
                for field in ("input_tokens", "output_tokens", "total_tokens", "cost_usd"):
                    val = _get(usage_data, field)
                    if val is not None:
                        setattr(self, f"_{field}", val)
                        data[field] = val

        elif raw_type in ("tool_call_start", "tool_call_end"):
            # Preserve whatever the SDK gives us
            if hasattr(update, "tool_call"):
                tc = update.tool_call
                data["tool_name"] = _get(tc, "name") or _get(tc, "tool_name") or ""
            elif isinstance(update, dict) and "tool_call" in update:
                tc = update["tool_call"]
                data["tool_name"] = tc.get("name") or tc.get("tool_name") or ""

        elif raw_type == "agent_thought_chunk":
            text = self._extract_text(update)
            data["text"] = text or ""

        record = EventRecord(
            event=normalized,
            source=EventSource.AGENT.value,
            job_id=self.job_id,
            session_id=session_id,
            timestamp=_now_iso(),
            data=data if data else None,
            raw_event_type=raw_type if normalized != raw_type else None,
        )
        self._events.append(record)
        self._event_signal.set()

    async def request_permission(
        self,
        session_id: str,
        tool_call: Any,
        options: Any,
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        """Auto-approve all permission requests."""
        log.debug(
            "request_permission: auto-approving tool_call=%r session_id=%s",
            tool_call, session_id,
        )
        return RequestPermissionResponse(
            outcome=AllowedOutcome(outcome="selected", option_id="allow_once")
        )

    # ------------------------------------------------------------------
    # Text assembly
    # ------------------------------------------------------------------

    def get_assembled_text(self) -> str:
        return "".join(self._text_chunks)

    # ------------------------------------------------------------------
    # Stub methods — Gemini handles files natively
    # ------------------------------------------------------------------

    def write_text_file(self, *args: Any, **kwargs: Any) -> None:
        return None

    def read_text_file(self, *args: Any, **kwargs: Any) -> None:
        return None

    def create_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("create_terminal is not supported")

    def terminal_output(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("terminal_output is not supported")

    def release_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("release_terminal is not supported")

    def wait_for_terminal_exit(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("wait_for_terminal_exit is not supported")

    def kill_terminal(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("kill_terminal is not supported")

    def ext_method(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("ext_method is not supported")

    def ext_notification(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError("ext_notification is not supported")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_text(update: Any) -> str:
        """Extract text from an agent_message_chunk or thought_chunk update."""
        if hasattr(update, "content"):
            content = update.content
        elif isinstance(update, dict):
            content = update.get("content") or update.get("text") or ""
        else:
            content = ""

        if isinstance(content, str):
            return content
        if hasattr(content, "text"):
            return content.text or ""
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if hasattr(block, "text"):
                    parts.append(block.text or "")
                elif isinstance(block, dict):
                    parts.append(block.get("text") or "")
            return "".join(parts)
        if isinstance(content, dict):
            return content.get("text", "")
        return ""


# ---------------------------------------------------------------------------
# GeminiAcpTransport — AgentTransport implementation
# ---------------------------------------------------------------------------

class GeminiAcpTransport(AgentTransport):
    """ACP SDK-backed transport for the Gemini CLI."""

    def __init__(
        self,
        job_id: str,
        *,
        handshake_timeout_s: float = 20.0,
        shutdown_timeout_s: float = 5.0,
        cancel_timeout_s: float = 10.0,
    ) -> None:
        self.job_id = job_id
        self.handshake_timeout_s = handshake_timeout_s
        self.shutdown_timeout_s = shutdown_timeout_s
        self.cancel_timeout_s = cancel_timeout_s

        self.client: GeminiAcpClient = GeminiAcpClient(job_id)
        self._conn: Any = None
        self._process: Any = None
        self._transport_cm: Any = None  # context manager from spawn_stdio_transport
        self._reader: Any = None
        self._writer: Any = None

    # ------------------------------------------------------------------
    # AgentTransport interface
    # ------------------------------------------------------------------

    async def spawn(self, cwd: str, env: dict) -> None:
        self._transport_cm = spawn_stdio_transport(
            "gemini", "--acp", env=env, cwd=cwd,
        )
        reader, writer, process = await self._transport_cm.__aenter__()
        self._reader = reader
        self._writer = writer
        self._process = process

        self._conn = connect_to_agent(
            self.client, writer, reader,
            use_unstable_protocol=True,
        )

    async def initialize(self, timeout_s: float | None = None) -> InitResult:
        timeout = timeout_s if timeout_s is not None else self.handshake_timeout_s
        async with asyncio.timeout(timeout):
            resp = await self._conn.initialize(
                protocol_version=PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(),
                client_info=Implementation(
                    name="gemini-acp-companion",
                    title="Gemini ACP Companion",
                    version=VERSION,
                ),
            )

        result = InitResult()
        if resp is not None:
            result.protocol_version = _get(resp, "protocol_version") or PROTOCOL_VERSION
            caps = _get(resp, "capabilities")
            if caps is not None:
                result.capabilities = caps if isinstance(caps, dict) else {}
            agent_info = _get(resp, "agent_info") or _get(resp, "server_info")
            if agent_info is not None:
                result.agent_info = agent_info if isinstance(agent_info, dict) else None
        return result

    async def new_session(self) -> str:
        resp = await self._conn.new_session(cwd=os.getcwd())
        if hasattr(resp, "session_id"):
            return resp.session_id
        if isinstance(resp, dict):
            return resp.get("session_id", "")
        return str(resp)

    async def load_session(self, session_id: str) -> str:
        resp = await self._conn.load_session(
            cwd=os.getcwd(), session_id=session_id,
        )
        if hasattr(resp, "session_id"):
            return resp.session_id
        return session_id

    async def send_prompt(self, text: str, session_id: str) -> None:
        try:
            await self._conn.prompt(
                prompt=[TextContentBlock(type="text", text=text)],
                session_id=session_id,
            )
        finally:
            self.client._prompt_done = True
            self.client._event_signal.set()

    async def stream_events(self) -> AsyncIterator[dict]:
        """Yield EventRecords (as dicts) from the client's deque."""
        while True:
            # Drain everything currently in the queue
            while self.client._events:
                record = self.client._events.popleft()
                yield record

            # Check termination conditions
            if self.client._prompt_done and not self.client._events:
                return
            if not self.is_alive() and not self.client._events:
                return

            # Wait for new events
            self.client._event_signal.clear()
            try:
                await asyncio.wait_for(
                    self.client._event_signal.wait(), timeout=1.0,
                )
            except asyncio.TimeoutError:
                # Re-check loop conditions
                continue

    async def cancel(self, session_id: str) -> None:
        try:
            async with asyncio.timeout(self.cancel_timeout_s):
                await self._conn.cancel(session_id=session_id)
        except Exception:
            log.warning("cancel failed for session %s", session_id, exc_info=True)

    async def close(self) -> None:
        # Phase 1: close ACP session
        if self._conn is not None:
            try:
                async with asyncio.timeout(self.shutdown_timeout_s):
                    await self._conn.close()
            except Exception:
                log.debug("ACP conn.close() error (non-fatal)", exc_info=True)
            self._conn = None

        # Phase 2: transport teardown via context manager
        if self._transport_cm is not None:
            try:
                await self._transport_cm.__aexit__(None, None, None)
            except Exception:
                log.debug("Transport CM exit error (non-fatal)", exc_info=True)
            self._transport_cm = None

        # Phase 3: SIGTERM process group fallback
        if self._process is not None and self._process.returncode is None:
            try:
                pgid = os.getpgid(self._process.pid)
                os.killpg(pgid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            self._process = None

    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None
