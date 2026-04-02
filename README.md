# Gemini Plugin for Claude Code

A Claude Code plugin that wraps Google's [Gemini CLI](https://github.com/google-gemini/gemini-cli) as native slash commands, giving you access to Gemini as a second opinion, UI/UX advisor, and code reviewer — all without leaving Claude Code.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
- Node.js 18+

```bash
npm install -g @google/gemini-cli
gemini  # triggers browser OAuth on first run
```

## Installation

Copy this plugin into your Claude Code plugins cache:

```bash
mkdir -p ~/.claude/plugins/cache/google-gemini/gemini/1.0.0
cp -r . ~/.claude/plugins/cache/google-gemini/gemini/1.0.0/
```

Then add the following entry to `~/.claude/plugins/installed_plugins.json` under `"plugins"`:

```json
"gemini@google-gemini": [
  {
    "scope": "user",
    "installPath": "/home/YOUR_USER/.claude/plugins/cache/google-gemini/gemini/1.0.0",
    "version": "1.0.0",
    "installedAt": "2026-04-01T00:00:00.000Z",
    "lastUpdated": "2026-04-01T00:00:00.000Z"
  }
]
```

Restart Claude Code to load the plugin.

## Commands

| Command | Description |
|---------|-------------|
| `/gemini:setup` | Check Gemini CLI availability and auth status |
| `/gemini:ask <question>` | Ask Gemini a question or get a second opinion |
| `/gemini:review [focus]` | Code review using git diff (e.g. `security`, `performance`) |
| `/gemini:ui-review [focus]` | UI/UX focused review with accessibility checks |
| `/gemini:task <prompt>` | Delegate a general task to Gemini |

### Examples

```
/gemini:ask "What's the best caching strategy for this API?"
/gemini:review security
/gemini:review --base main --scope branch
/gemini:ui-review --file resources/views/login.blade.php "form usability"
/gemini:task "Generate test cases for the payment callback flow"
```

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `--model <model>` | ask, task | Override the Gemini model |
| `--base <ref>` | review | Base git ref for diff (default: HEAD) |
| `--scope <auto\|working-tree\|branch>` | review | What to diff |
| `--file <path>` | ui-review | Specific file to review |
| `--yolo` | task | Auto-approve Gemini tool use |
| `--json` | setup | JSON output |

## Architecture

```
.claude-plugin/plugin.json     # Plugin manifest
commands/*.md                  # Slash command definitions (YAML frontmatter)
scripts/gemini-companion.mjs   # Main entry point — routes subcommands
scripts/lib/gemini.mjs         # Spawns Gemini CLI, captures output
scripts/lib/context.mjs        # Git diff and file context gathering
scripts/lib/args.mjs           # Argument parsing
prompts/*.md                   # Prompt templates with {{variable}} interpolation
skills/                        # Skill definitions for Claude Code
agents/                        # Agent definitions for Claude Code
```

The plugin spawns `gemini` as a child process in non-interactive mode (`-o text`), pipes context via stdin when needed, and returns the response to Claude Code. No background servers or brokers required — each command is a single CLI invocation.

## How it fits into the workflow

This plugin is designed to complement [Codex](https://github.com/openai/codex) in a multi-model workflow:

| Topic | Use |
|-------|-----|
| UI flows, forms, UX clarity | **Gemini** |
| Error messages, copy, wording | **Gemini** |
| Accessibility, affordances | **Gemini** |
| Backend logic, performance | Codex |
| Schema design, concurrency | Codex |
| Security review | Codex |

**Key rule:** Gemini advises, Claude interprets, user decides.

## License

MIT
