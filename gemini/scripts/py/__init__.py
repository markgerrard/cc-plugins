"""Gemini ACP runtime package."""
from __future__ import annotations

import sys
from pathlib import Path

VERSION = "1.0.0"

# The ACP SDK is vendored in Vibe's uv tool environment.
# Add it to sys.path so we can import acp.
_ACP_SITE_PACKAGES = Path.home() / ".local/share/uv/tools/mistral-vibe/lib/python3.12/site-packages"
if _ACP_SITE_PACKAGES.is_dir() and str(_ACP_SITE_PACKAGES) not in sys.path:
    sys.path.insert(0, str(_ACP_SITE_PACKAGES))

JOBS_DIR = Path.home() / ".gemini-acp" / "jobs"
