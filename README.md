# Gemini Plugin for Claude Code

A Claude Code plugin that wraps Google's [Gemini CLI](https://github.com/google-gemini/gemini-cli) as native slash commands, giving you access to Gemini as a second opinion, UI/UX advisor, design architect, and code reviewer — all without leaving Claude Code.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
- Node.js 18+

```bash
npm install -g @google/gemini-cli
gemini  # triggers browser OAuth on first run
```

## Installation

**Recommended:** Use the [claude-code-llm-plugins](https://github.com/markgerrard/claude-code-llm-plugins) monorepo which bundles this plugin alongside Codex:

```bash
git clone https://github.com/markgerrard/claude-code-llm-plugins.git
cd claude-code-llm-plugins
./install.sh gemini   # or ./install.sh for both Codex + Gemini
```

**Manual install:**

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
| `/gemini:review [focus]` | Code review using git diff |
| `/gemini:adversarial-review [focus]` | Hostile code review — assumes bugs exist |
| `/gemini:ui-review [focus]` | UI/UX defect review (ruthless critic) |
| `/gemini:ui-design [brief]` | Creative UI design suggestions (opinionated architect) |
| `/gemini:task <prompt>` | Delegate a general task to Gemini |
| `/gemini:status [job-id]` | Show active and recent background jobs |
| `/gemini:result [job-id]` | Show finished job output |
| `/gemini:cancel [job-id]` | Cancel an active background job |

### Examples

```
/gemini:ask "What's the best caching strategy for this API?"
/gemini:review security
/gemini:review --background --base main --scope branch
/gemini:adversarial-review "authentication flow"
/gemini:ui-review --file login.blade.php "form usability"
/gemini:ui-design "Design a modern payment confirmation page"
/gemini:ui-design --file screenshot.png "Keep layout but make it premium"
/gemini:task --model pro "Generate test cases for the payment callback flow"
/gemini:status
/gemini:result
```

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `--background` | all action commands | Run in background, returns job ID |
| `--wait` | all action commands | Run in foreground (default) |
| `--model <model>` | ask, task, ui-design | Override the Gemini model (or use alias) |
| `--base <ref>` | review, adversarial-review | Base git ref for diff (default: HEAD) |
| `--scope <auto\|working-tree\|branch>` | review, adversarial-review | What to diff |
| `--file <path>` | ui-review, ui-design | File to review/analyse (supports images) |
| `--resume <id\|latest>` | ask, task | Resume a previous Gemini CLI session |
| `--yolo` | task | Auto-approve Gemini tool use |
| `--json` | setup, status, result | JSON output |
| `--all` | status | Show full job history |

### Model Aliases

| Alias | Model |
|-------|-------|
| `pro` | gemini-3.1-pro-preview |
| `flash` | gemini-3-flash-preview |
| `25pro` | gemini-2.5-pro |
| `25flash` | gemini-2.5-flash |
| `lite` | gemini-2.5-flash-lite |

## Architecture

```
.claude-plugin/plugin.json          # Plugin manifest
commands/*.md                       # Slash command definitions (YAML frontmatter)
scripts/gemini-companion.mjs        # Main entry point — routes subcommands
scripts/lib/
  gemini.mjs                        # Spawns Gemini CLI, captures output, model aliases
  context.mjs                       # Git diff and file context gathering
  args.mjs                          # Argument parsing
  state.mjs                         # File-based job persistence per workspace
  tracked-jobs.mjs                  # Job lifecycle tracking
  job-control.mjs                   # Job querying, filtering, resolution
  render.mjs                        # Output formatting for status/result/cancel
  process.mjs                       # Process tree termination
  workspace.mjs                     # Git workspace root detection
scripts/session-lifecycle-hook.mjs  # Session start/end cleanup
hooks/hooks.json                    # Session lifecycle hook config
prompts/*.md                        # Prompt templates with {{variable}} interpolation
skills/                             # Skill definitions for Claude Code
agents/                             # Agent definitions for Claude Code
```

### How it works

- **Foreground commands** spawn `gemini` as a child process in non-interactive mode, pipe large payloads (git diffs, file contents) via stdin to avoid OS argument limits, and return the response to Claude Code.
- **Background commands** (`--background`) spawn a detached worker process that writes results to disk. Use `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to manage them.
- **Session hooks** set a session ID on start and clean up stale jobs on end.
- **Prompt templates** are tuned for terminal output — structured bullets, no fluff, severity-tagged findings.

## Multi-model workflow

This plugin is designed to complement [Codex](https://github.com/openai/codex) in a multi-model workflow:

| Task | Best tool |
|------|-----------|
| UI/UX defect review | `/gemini:ui-review` |
| UI design suggestions | `/gemini:ui-design` |
| Copy, error messages, wording | `/gemini:ask` |
| Accessibility audit | `/gemini:ui-review` |
| Code review | `/gemini:review` or `/codex:review` |
| Security/adversarial review | `/gemini:adversarial-review` or `/codex:adversarial-review` |
| Backend logic, performance | `/codex:task` |
| Schema design, concurrency | `/codex:task` |

**Key rule:** Gemini advises, Claude interprets, user decides.

## License

MIT