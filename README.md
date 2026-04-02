# Claude Code LLM Plugins

Multi-model plugins for [Claude Code](https://claude.ai/claude-code) — use OpenAI Codex, Google Gemini, and xAI Grok as second opinions, code reviewers, design advisors, and social signal scanners without leaving your terminal.

## Plugins

| Plugin | Purpose | Commands |
|--------|---------|----------|
| **Codex** | Code review, task delegation | `/codex:review`, `/codex:task`, `/codex:status`, `/codex:result`, `/codex:cancel` |
| **Gemini** | UI/UX review, design, code review | `/gemini:ask`, `/gemini:review`, `/gemini:ui-review`, `/gemini:ui-design`, `/gemini:adversarial-review`, `/gemini:task` |
| **Grok** | X/Twitter sentiment, social signals | `/grok:sentiment`, `/grok:pulse`, `/grok:compare`, `/grok:ask` |

All plugins support background jobs (`--background`) with `/status`, `/result`, `/cancel`.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code)
- Node.js 18+
- `rsync` and `jq` (for the install script)

Per-plugin requirements:
- **Codex:** [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- **Gemini:** [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`
- **Grok:** xAI API key from [console.x.ai](https://console.x.ai) — set `XAI_API_KEY` env var

## Install

```bash
git clone https://github.com/markgerrard/claude-code-llm-plugins.git
cd claude-code-llm-plugins
./install.sh
```

Install individual plugins:
```bash
./install.sh codex    # Codex only
./install.sh gemini   # Gemini only
./install.sh grok     # Grok only
```

Restart Claude Code after installing.

## Uninstall

```bash
./install.sh uninstall
```

## Updating

Pull the latest and reinstall:
```bash
git pull
./install.sh
```

### Syncing subtrees

```bash
# Codex (fork of openai/codex-plugin-cc)
git subtree pull --prefix=codex https://github.com/markgerrard/codex-plugin-cc.git main --squash

# Gemini
git subtree pull --prefix=gemini https://github.com/markgerrard/gemini-plugin-cc.git main --squash

# Grok
git subtree pull --prefix=grok https://github.com/markgerrard/grok-plugin-cc.git main --squash
```

### Syncing Codex upstream

```bash
cd /tmp && git clone https://github.com/markgerrard/codex-plugin-cc.git && cd codex-plugin-cc
git remote add upstream https://github.com/openai/codex-plugin-cc.git
git fetch upstream && git merge upstream/main && git push origin main
```

## Architecture

```
claude-code-llm-plugins/
├── codex/              ← subtree from markgerrard/codex-plugin-cc (fork of openai)
│   └── plugins/codex/  ← the actual Claude Code plugin
├── gemini/             ← subtree from markgerrard/gemini-plugin-cc
│   ├── commands/       ← slash command definitions
│   ├── scripts/        ← Node.js companion wrapping Gemini CLI
│   └── prompts/        ← prompt templates
├── grok/               ← subtree from markgerrard/grok-plugin-cc
│   ├── commands/       ← slash command definitions
│   ├── scripts/        ← Node.js companion wrapping xAI API (direct HTTP)
│   └── prompts/        ← prompt templates
└── install.sh          ← installs plugins into ~/.claude/plugins/
```

## License

Gemini plugin: MIT
Grok plugin: MIT
Codex plugin: See `codex/LICENSE`