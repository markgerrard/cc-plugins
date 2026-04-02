# Claude Code LLM Plugins

Multi-model plugins for [Claude Code](https://claude.ai/claude-code) — use OpenAI Codex and Google Gemini as second opinions, code reviewers, and design advisors without leaving your terminal.

## Plugins

| Plugin | Source | Commands |
|--------|--------|----------|
| **Codex** | [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) | `/codex:review`, `/codex:task`, `/codex:status`, `/codex:result`, `/codex:cancel` |
| **Gemini** | Custom | `/gemini:ask`, `/gemini:review`, `/gemini:ui-review`, `/gemini:ui-design`, `/gemini:adversarial-review`, `/gemini:task`, `/gemini:status`, `/gemini:result`, `/gemini:cancel` |

## Prerequisites

- [Claude Code](https://claude.ai/claude-code)
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`
- Node.js 18+
- `rsync` and `jq` (for the install script)

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

### Syncing Codex upstream

The `codex/` directory is a git subtree from a [fork of openai/codex-plugin-cc](https://github.com/markgerrard/codex-plugin-cc). To pull upstream updates:

```bash
# Sync fork with OpenAI upstream (one-time setup)
cd /tmp && git clone https://github.com/markgerrard/codex-plugin-cc.git && cd codex-plugin-cc
git remote add upstream https://github.com/openai/codex-plugin-cc.git
git fetch upstream && git merge upstream/main && git push origin main

# Then pull into monorepo
cd /path/to/claude-code-llm-plugins
git subtree pull --prefix=codex https://github.com/markgerrard/codex-plugin-cc.git main --squash
```

### Updating Gemini

```bash
git subtree pull --prefix=gemini https://github.com/markgerrard/gemini-plugin-cc.git main --squash
```

## Architecture

```
claude-code-llm-plugins/
├── codex/              ← subtree from markgerrard/codex-plugin-cc (fork of openai)
│   └── plugins/codex/  ← the actual Claude Code plugin
├── gemini/             ← subtree from markgerrard/gemini-plugin-cc
│   ├── commands/       ← slash command definitions
│   ├── scripts/        ← Node.js companion + libraries
│   ├── prompts/        ← prompt templates
│   ├── hooks/          ← session lifecycle hooks
│   ├── skills/         ← Claude Code skill definitions
│   └── agents/         ← agent definitions
└── install.sh          ← installs plugins into ~/.claude/plugins/
```

## License

Gemini plugin: MIT
Codex plugin: See `codex/LICENSE`