#!/usr/bin/env bash
set -euo pipefail

# install.sh — Install LLM plugins into Claude Code
#
# Handles all four registration points:
#   1. Cache: copy plugin files to ~/.claude/plugins/cache/
#   2. installed_plugins.json: register plugin version + path
#   3. settings.json: enable plugin + register marketplace
#   4. known_marketplaces.json: register marketplace source
#
# Usage:
#   ./install.sh                Install all plugins
#   ./install.sh codex          Install Codex only
#   ./install.sh gemini         Install Gemini only
#   ./install.sh grok           Install Grok only
#   ./install.sh glm            Install GLM only
#   ./install.sh minimax        Install MiniMax only
#   ./install.sh banana         Install Nano Banana only
#   ./install.sh pi             Install Pi coding agent
#   ./install.sh uninstall      Remove all plugins
#   ./install.sh vibe           Install Mistral Vibe only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
PLUGINS_DIR="${CLAUDE_DIR}/plugins"
CACHE_DIR="${PLUGINS_DIR}/cache"
MARKETPLACE_DIR="${PLUGINS_DIR}/marketplaces"
INSTALLED_FILE="${PLUGINS_DIR}/installed_plugins.json"
KNOWN_MP_FILE="${PLUGINS_DIR}/known_marketplaces.json"
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# ─── Plugin definitions ──────────────────────────────────────────────
# Each plugin: NAME SRC_DIR MARKETPLACE PLUGIN_NAME VERSION

declare -A PLUGIN_SRC PLUGIN_MP PLUGIN_NAME PLUGIN_VER

PLUGIN_SRC[codex]="${SCRIPT_DIR}/codex/plugins/codex"
PLUGIN_MP[codex]="openai-codex"
PLUGIN_NAME[codex]="codex"
PLUGIN_VER[codex]="1.0.0"

PLUGIN_SRC[gemini]="${SCRIPT_DIR}/gemini"
PLUGIN_MP[gemini]="google-gemini"
PLUGIN_NAME[gemini]="gemini"
PLUGIN_VER[gemini]="1.0.0"

PLUGIN_SRC[grok]="${SCRIPT_DIR}/grok"
PLUGIN_MP[grok]="xai-grok"
PLUGIN_NAME[grok]="grok"
PLUGIN_VER[grok]="1.0.0"

PLUGIN_SRC[glm]="${SCRIPT_DIR}/glm"
PLUGIN_MP[glm]="zhipu-glm"
PLUGIN_NAME[glm]="glm"
PLUGIN_VER[glm]="1.0.0"

PLUGIN_SRC[minimax]="${SCRIPT_DIR}/minimax"
PLUGIN_MP[minimax]="minimax"
PLUGIN_NAME[minimax]="minimax"
PLUGIN_VER[minimax]="1.0.0"

PLUGIN_SRC[banana]="${SCRIPT_DIR}/nano-banana"
PLUGIN_MP[banana]="nano-banana"
PLUGIN_NAME[banana]="nano-banana"
PLUGIN_VER[banana]="1.0.0"

PLUGIN_SRC[postmark]="${SCRIPT_DIR}/postmark"
PLUGIN_MP[postmark]="postmark"
PLUGIN_NAME[postmark]="postmark"
PLUGIN_VER[postmark]="1.0.0"

PLUGIN_SRC[gdrive]="${SCRIPT_DIR}/google-drive"
PLUGIN_MP[gdrive]="google-drive"
PLUGIN_NAME[gdrive]="google-drive"
PLUGIN_VER[gdrive]="1.0.0"

PLUGIN_SRC[compare]="${SCRIPT_DIR}/compare"
PLUGIN_MP[compare]="compare"
PLUGIN_NAME[compare]="compare"
PLUGIN_VER[compare]="1.0.0"

ALL_PLUGINS=(codex gemini grok glm minimax banana postmark gdrive compare)

info()  { echo "  [+] $1"; }
warn()  { echo "  [!] $1"; }
error() { echo "  [x] $1" >&2; exit 1; }

# ─── Helpers ─────────────────────────────────────────────────────────

ensure_json_file() {
  local file="$1" default="$2"
  if [ ! -f "$file" ]; then
    echo "$default" > "$file"
  fi
}

check_jq() {
  if ! command -v jq &>/dev/null; then
    error "jq is required. Install: apt install jq / brew install jq"
  fi
}

# ─── Core install function ───────────────────────────────────────────

install_plugin() {
  local slug="$1"
  local src="${PLUGIN_SRC[$slug]}"
  local marketplace="${PLUGIN_MP[$slug]}"
  local plugin_name="${PLUGIN_NAME[$slug]}"
  local version="${PLUGIN_VER[$slug]}"
  local key="${plugin_name}@${marketplace}"
  local dest="${CACHE_DIR}/${marketplace}/${plugin_name}/${version}"
  local mp_dir="${MARKETPLACE_DIR}/${marketplace}"

  # Verify source
  if [ ! -d "$src" ]; then
    error "${slug}: source not found at ${src}"
  fi
  if [ ! -f "${src}/.claude-plugin/plugin.json" ]; then
    error "${slug}: missing .claude-plugin/plugin.json"
  fi

  # ── 1. Cache: copy plugin files ──
  mkdir -p "$(dirname "$dest")"
  if [ -d "$dest" ]; then
    info "${slug}: updating cache at ${dest}"
  else
    info "${slug}: installing to cache at ${dest}"
  fi
  rsync -a --delete --exclude='__pycache__' --exclude='.git' "$src/" "$dest/"

  # ── 2. Marketplace: create directory source ──
  mkdir -p "${mp_dir}/.claude-plugin"
  mkdir -p "${mp_dir}/plugins/${plugin_name}"
  rsync -a --delete --exclude='__pycache__' --exclude='.git' "$src/" "${mp_dir}/plugins/${plugin_name}/"

  # Create marketplace.json if missing
  if [ ! -f "${mp_dir}/.claude-plugin/marketplace.json" ]; then
    local desc
    desc=$(jq -r '.description // "LLM plugin"' "${src}/.claude-plugin/plugin.json")
    cat > "${mp_dir}/.claude-plugin/marketplace.json" << MPEOF
{
  "name": "${marketplace}",
  "owner": {"name": "Mark"},
  "metadata": {"description": "${desc}", "version": "${version}"},
  "plugins": [
    {
      "name": "${plugin_name}",
      "description": "${desc}",
      "version": "${version}",
      "author": {"name": "Mark"},
      "source": "./plugins/${plugin_name}"
    }
  ]
}
MPEOF
    info "${slug}: created marketplace manifest"
  fi

  # ── 3. installed_plugins.json ──
  ensure_json_file "$INSTALLED_FILE" '{"version":2,"plugins":{}}'
  local entry
  entry=$(jq -n \
    --arg scope "user" \
    --arg path "$dest" \
    --arg ver "$version" \
    --arg now "$NOW" \
    '[{"scope":$scope,"installPath":$path,"version":$ver,"installedAt":$now,"lastUpdated":$now}]'
  )
  local updated
  updated=$(jq --arg key "$key" --argjson entry "$entry" \
    '.plugins[$key] = $entry' "$INSTALLED_FILE")
  echo "$updated" > "$INSTALLED_FILE"
  info "${slug}: registered in installed_plugins.json"

  # ── 4. known_marketplaces.json ──
  ensure_json_file "$KNOWN_MP_FILE" '{}'
  updated=$(jq --arg mp "$marketplace" --arg path "$mp_dir" --arg now "$NOW" \
    '.[$mp] = {"source":{"source":"directory","path":$path},"installLocation":$path,"lastUpdated":$now}' \
    "$KNOWN_MP_FILE")
  echo "$updated" > "$KNOWN_MP_FILE"
  info "${slug}: registered in known_marketplaces.json"

  # ── 5. settings.json: enable plugin + register marketplace ──
  ensure_json_file "$SETTINGS_FILE" '{}'

  # Enable plugin
  updated=$(jq --arg key "$key" \
    '.enabledPlugins[$key] = true' "$SETTINGS_FILE")
  echo "$updated" > "$SETTINGS_FILE"

  # Register marketplace in extraKnownMarketplaces
  updated=$(jq --arg mp "$marketplace" --arg path "$mp_dir" \
    '.extraKnownMarketplaces[$mp] = {"source":{"source":"directory","path":$path}}' \
    "$SETTINGS_FILE")
  echo "$updated" > "$SETTINGS_FILE"
  info "${slug}: enabled in settings.json"

  # ── 6. Remove any .orphaned_at markers ──
  find "$dest" -name ".orphaned_at" -delete 2>/dev/null || true

  # ── 7. Python deps (if the plugin ships a requirements.txt) ──
  # Some plugins (gemini ACP bridge, etc.) depend on Python packages
  # that aren't vendored into the repo. Install them on behalf of the user
  # so the ACP handshake doesn't fail with a ModuleNotFoundError on first run.
  local reqs
  for reqs in "${src}/requirements.txt" "${src}/scripts/requirements.txt" "${src}/scripts/py/requirements.txt"; do
    if [ -f "$reqs" ]; then
      info "${slug}: installing Python deps from $(basename "$(dirname "$reqs")")/requirements.txt"
      if command -v python3 >/dev/null 2>&1; then
        # Prefer --user; --break-system-packages is required on Debian/Ubuntu
        # where the system Python marks dist-packages as externally-managed.
        python3 -m pip install --user --break-system-packages -q -r "$reqs" 2>&1 \
          | grep -vE '^\s*$' \
          || warn "${slug}: pip install reported non-zero; check output above"
      else
        warn "${slug}: python3 not on PATH — skipped Python deps. Install manually: python3 -m pip install -r $reqs"
      fi
      break
    fi
  done
}

# ─── Uninstall function ──────────────────────────────────────────────

uninstall_plugin() {
  local slug="$1"
  local marketplace="${PLUGIN_MP[$slug]}"
  local plugin_name="${PLUGIN_NAME[$slug]}"
  local version="${PLUGIN_VER[$slug]}"
  local key="${plugin_name}@${marketplace}"
  local dest="${CACHE_DIR}/${marketplace}/${plugin_name}/${version}"
  local mp_dir="${MARKETPLACE_DIR}/${marketplace}"

  # Remove cache
  if [ -d "$dest" ]; then
    rm -rf "$dest"
    info "${slug}: removed cache"
  fi

  # Remove marketplace
  if [ -d "$mp_dir" ]; then
    rm -rf "$mp_dir"
    info "${slug}: removed marketplace"
  fi

  # Remove from installed_plugins.json
  if [ -f "$INSTALLED_FILE" ] && command -v jq &>/dev/null; then
    local updated
    updated=$(jq --arg key "$key" 'del(.plugins[$key])' "$INSTALLED_FILE")
    echo "$updated" > "$INSTALLED_FILE"
  fi

  # Remove from known_marketplaces.json
  if [ -f "$KNOWN_MP_FILE" ] && command -v jq &>/dev/null; then
    local updated
    updated=$(jq --arg mp "$marketplace" 'del(.[$mp])' "$KNOWN_MP_FILE")
    echo "$updated" > "$KNOWN_MP_FILE"
  fi

  # Remove from settings.json
  if [ -f "$SETTINGS_FILE" ] && command -v jq &>/dev/null; then
    local updated
    updated=$(jq --arg key "$key" --arg mp "$marketplace" \
      'del(.enabledPlugins[$key]) | del(.extraKnownMarketplaces[$mp])' "$SETTINGS_FILE")
    echo "$updated" > "$SETTINGS_FILE"
  fi

  info "${slug}: uninstalled"
}

# ─── Pi coding agent ─────────────────────────────────────────────────

install_pi() {
  if command -v pi &>/dev/null; then
    info "Pi coding agent already installed ($(pi --version 2>/dev/null || echo 'unknown'))"
  else
    info "Installing Pi coding agent globally..."
    npm install -g @mariozechner/pi-coding-agent
  fi

  if [ ! -f "${HOME}/.pi/agent/models.json" ]; then
    mkdir -p "${HOME}/.pi/agent"
    info "Creating ~/.pi/agent/models.json with GLM, MiniMax, and Grok providers"
    cat > "${HOME}/.pi/agent/models.json" << 'PIEOF'
{
  "providers": {
    "minimax": {
      "baseUrl": "https://api.minimax.io/v1",
      "apiKey": "MINIMAX_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "MiniMax-M2.7-highspeed", "contextWindow": 1000000 },
        { "id": "MiniMax-M2-highspeed", "contextWindow": 1000000 }
      ]
    },
    "glm": {
      "baseUrl": "https://api.z.ai/api/coding/paas/v4",
      "apiKey": "ZHIPU_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "glm-5-turbo", "contextWindow": 131072 },
        { "id": "glm-5", "contextWindow": 131072 },
        { "id": "glm-4.5-flash", "contextWindow": 131072 }
      ]
    },
    "grok": {
      "baseUrl": "https://api.x.ai/v1",
      "apiKey": "XAI_API_KEY",
      "api": "openai-completions",
      "models": [
        { "id": "grok-4-1-fast-non-reasoning", "contextWindow": 2000000 },
        { "id": "grok-4.20-0309-non-reasoning", "contextWindow": 2000000 }
      ]
    }
  }
}
PIEOF
  else
    info "Pi models.json already exists at ~/.pi/agent/models.json"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────

echo ""
echo "Claude Code LLM Plugins Installer"
echo "──────────────────────────────────"

# Ensure base dirs exist
mkdir -p "$PLUGINS_DIR" "$CACHE_DIR" "$MARKETPLACE_DIR"

# jq is required for all registration
check_jq

TARGET="${1:-all}"

case "$TARGET" in
  codex|gemini|grok|glm|minimax|banana|postmark|gdrive|compare)
    install_plugin "$TARGET"
    ;;
  pi)
    install_pi
    ;;
  all)
    for p in "${ALL_PLUGINS[@]}"; do
      install_plugin "$p"
    done
    install_pi
    ;;
  uninstall)
    for p in "${ALL_PLUGINS[@]}"; do
      uninstall_plugin "$p"
    done
    ;;
  *)
    echo "Usage: $0 [codex|gemini|grok|glm|minimax|banana|pi|all|uninstall]"
    exit 1
    ;;
esac

echo ""
echo "Done. Restart Claude Code to load the plugins."
echo "  Tip: run /reload-plugins inside Claude Code"
echo ""
