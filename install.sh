#!/usr/bin/env bash
set -euo pipefail

# install.sh — Install LLM plugins into Claude Code
#
# Usage:
#   ./install.sh          Install all plugins
#   ./install.sh codex    Install Codex only
#   ./install.sh gemini   Install Gemini only
#   ./install.sh grok     Install Grok only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="${HOME}/.claude/plugins"
CACHE_DIR="${PLUGINS_DIR}/cache"
INSTALLED_FILE="${PLUGINS_DIR}/installed_plugins.json"

# Plugin source paths (inside this repo)
CODEX_SRC="${SCRIPT_DIR}/codex/plugins/codex"
GEMINI_SRC="${SCRIPT_DIR}/gemini"
GROK_SRC="${SCRIPT_DIR}/grok"

# Plugin install paths
CODEX_DEST="${CACHE_DIR}/openai-codex/codex/local"
GEMINI_DEST="${CACHE_DIR}/google-gemini/gemini/local"
GROK_DEST="${CACHE_DIR}/xai-grok/grok/local"

# Plugin registry keys
CODEX_KEY="codex@openai-codex"
GEMINI_KEY="gemini@google-gemini"
GROK_KEY="grok@xai-grok"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

info()  { echo "  [+] $1"; }
warn()  { echo "  [!] $1"; }
error() { echo "  [x] $1" >&2; exit 1; }

install_plugin() {
  local name="$1" src="$2" dest="$3" key="$4" version="$5"

  # Verify source exists
  if [ ! -d "$src" ]; then
    error "${name} source not found at ${src}"
  fi
  if [ ! -f "${src}/.claude-plugin/plugin.json" ]; then
    error "${name} source missing .claude-plugin/plugin.json"
  fi

  # Create destination and sync
  mkdir -p "$(dirname "$dest")"
  if [ -d "$dest" ]; then
    info "${name}: updating existing install at ${dest}"
    rsync -a --delete "$src/" "$dest/"
  else
    info "${name}: installing to ${dest}"
    rsync -a "$src/" "$dest/"
  fi

  # Update installed_plugins.json
  if [ ! -f "$INSTALLED_FILE" ]; then
    info "Creating ${INSTALLED_FILE}"
    echo '{"version":2,"plugins":{}}' > "$INSTALLED_FILE"
  fi

  # Check if jq is available
  if ! command -v jq &>/dev/null; then
    warn "jq not found — skipping registry update for ${name}."
    warn "Manually add ${key} to ${INSTALLED_FILE}"
    return
  fi

  # Upsert the plugin entry
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

  info "${name}: registered in installed_plugins.json"
}

uninstall_plugin() {
  local name="$1" dest="$2" key="$3"

  if [ -d "$dest" ]; then
    rm -rf "$dest"
    info "${name}: removed ${dest}"
  fi

  if command -v jq &>/dev/null && [ -f "$INSTALLED_FILE" ]; then
    local updated
    updated=$(jq --arg key "$key" 'del(.plugins[$key])' "$INSTALLED_FILE")
    echo "$updated" > "$INSTALLED_FILE"
    info "${name}: removed from installed_plugins.json"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────

echo ""
echo "Claude Code LLM Plugins Installer"
echo "──────────────────────────────────"

# Ensure base dirs exist
mkdir -p "$PLUGINS_DIR" "$CACHE_DIR"

TARGET="${1:-all}"

case "$TARGET" in
  codex)
    install_plugin "Codex" "$CODEX_SRC" "$CODEX_DEST" "$CODEX_KEY" "local"
    ;;
  gemini)
    install_plugin "Gemini" "$GEMINI_SRC" "$GEMINI_DEST" "$GEMINI_KEY" "local"
    ;;
  grok)
    install_plugin "Grok" "$GROK_SRC" "$GROK_DEST" "$GROK_KEY" "local"
    ;;
  all)
    install_plugin "Codex" "$CODEX_SRC" "$CODEX_DEST" "$CODEX_KEY" "local"
    install_plugin "Gemini" "$GEMINI_SRC" "$GEMINI_DEST" "$GEMINI_KEY" "local"
    install_plugin "Grok" "$GROK_SRC" "$GROK_DEST" "$GROK_KEY" "local"
    ;;
  uninstall)
    uninstall_plugin "Codex" "$CODEX_DEST" "$CODEX_KEY"
    uninstall_plugin "Gemini" "$GEMINI_DEST" "$GEMINI_KEY"
    uninstall_plugin "Grok" "$GROK_DEST" "$GROK_KEY"
    ;;
  *)
    echo "Usage: $0 [codex|gemini|grok|all|uninstall]"
    exit 1
    ;;
esac

echo ""
echo "Done. Restart Claude Code to load the plugins."
echo ""
