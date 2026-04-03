# Claude Code LLM Plugins — Mono Repo

## What this repo is

A mono repo of Claude Code plugins that integrate external LLM providers as second opinions, code reviewers, coding agents, and specialised tools. Each plugin is a standalone Claude Code plugin with commands, skills, agents, and scripts.

## Repo structure

```
codex/          — OpenAI Codex plugin (Node.js, spawns codex CLI)
gemini/         — Google Gemini plugin (Node.js + Python ACP runtime)
grok/           — xAI Grok plugin (Node.js, direct API)
glm/            — Zhipu GLM plugin (Node.js, API + Pi coding agent)
minimax/        — MiniMax plugin (Node.js, API + Pi coding agent)
nano-banana/    — Gemini image generation plugin (Node.js)
pi/             — Pi coding agent mono repo (used by glm/minimax for /code)
install.sh      — Installs all plugins into Claude Code (handles all 4 registration points)
```

## Plugin anatomy

Every plugin follows the same structure:
```
<plugin>/
  .claude-plugin/plugin.json    — Plugin metadata (name, version, description)
  commands/*.md                 — Slash commands (frontmatter + instructions)
  skills/*/SKILL.md             — Internal skills
  agents/*.md                   — Subagent definitions
  scripts/                      — Runtime code (Node.js entry + helpers)
  hooks/hooks.json              — Session lifecycle hooks (optional)
  prompts/*.md                  — Prompt templates (optional)
```

## Plugin registration (critical)

Claude Code requires FOUR registration points for a plugin to load. Missing any one causes orphaning:

1. **Cache** — `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` — the actual files
2. **installed_plugins.json** — `~/.claude/plugins/installed_plugins.json` — version + path
3. **known_marketplaces.json** — `~/.claude/plugins/known_marketplaces.json` — marketplace source
4. **settings.json** — `~/.claude/settings.json` — `enabledPlugins` + `extraKnownMarketplaces`

The `install.sh` script handles all four. Always use it for installation.

## Key conventions

- Plugin `name` in `plugin.json` must match the directory name in the marketplace `plugins/` folder and the key prefix in `enabledPlugins` (e.g. `"name": "gemini"` → `gemini@google-gemini`)
- Commands use `disable-model-invocation: true` when they shell out to a companion script
- Background jobs use detached worker processes, not Node child_process
- All companion scripts output JSON to stdout, diagnostics to stderr
- `--background` and `--stream` are never combined

## Architecture patterns

### API-only plugins (Grok, GLM ask/review, MiniMax ask/review)
Node companion → direct HTTP API call → JSON response. One-shot, no tool use.

### Pi-based execution (GLM code, MiniMax code)
Node companion → Pi RPC client → `pi --mode rpc --provider <name>` → model gets file access + bash via Pi's tool loop.

### ACP-based execution (Gemini, Vibe/Mistral)
Node companion → Python ACP runtime → `gemini --acp` / `vibe-acp` → full agent with tool use over ACP protocol.

### Gemini specifics
- Node entry point (`gemini-companion.mjs`) is a thin adapter — all ACP logic is in Python (`scripts/py/`)
- Python ACP runtime uses the `acp` SDK vendored at `~/.local/share/uv/tools/mistral-vibe/lib/python3.12/site-packages/`
- Warm pool daemon (`pool.py`) keeps `gemini --acp` alive between calls — reduces latency from ~28s to ~5s
- Pool listens on `~/.gemini-acp/pool.sock`, auto-stops after 30min idle
- Start pool: `python3 scripts/gemini-acp.py pool-warm`
- Jobs stored at `~/.gemini-acp/jobs/<job-id>/` (job.json, events.jsonl, result.json)

## Testing a plugin

```bash
# Test from the plugin directory:
cd gemini
node scripts/gemini-companion.mjs setup
node scripts/gemini-companion.mjs ask "Hello"

# Test after installing:
# In Claude Code: /reload-plugins then /gemini:setup
```

## API keys

| Plugin | Key | Where to set |
|--------|-----|-------------|
| Grok | `XAI_API_KEY` | `~/.grok/.env` or environment |
| GLM | `ZHIPU_API_KEY` | `~/.glm/.env` or environment |
| MiniMax | `MINIMAX_API_KEY` | `~/.minimax/.env` or environment |
| Vibe | `MISTRAL_API_KEY` | `~/.vibe/.env` or environment |
| Gemini | *(OAuth via CLI)* | Run `gemini` once to authenticate |
| Codex | *(via Codex CLI)* | Run `codex` once to authenticate |
| Nano Banana | `GOOGLE_API_KEY` | environment |

Pi reads keys from `~/.pi/agent/models.json` — the install script creates this with placeholders.

## When modifying plugins

- Edit in this repo, then run `./install.sh <plugin>` to sync to Claude Code
- Or edit in cache directly for quick iteration, then copy back here
- Always test with `node scripts/<companion>.mjs setup` before committing
- After syncing: `/reload-plugins` in Claude Code (no restart needed)

## Do not

- Put API keys in this repo
- Remove `__pycache__` entries from `.gitignore`
- Change `plugin.json` name without updating the marketplace manifest to match
- Mix Node and Python files in the same `lib/` directory (use `node/` and `py/`)
