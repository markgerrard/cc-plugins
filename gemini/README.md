# Gemini Plugin for Claude Code

A Claude Code plugin that brings Gemini into your workflow as a second model for adversarial review, UI/UX critique, design direction, and second-opinion reasoning — without leaving Claude Code.

**Operating model:** Gemini advises, Claude interprets, user decides.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
- Node.js 18+

```bash
npm install -g @google/gemini-cli
gemini  # triggers browser OAuth on first run
```

## Installation

**Recommended:** Use the [claude-code-llm-plugins](https://github.com/markgerrard/claude-code-llm-plugins) monorepo:

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

## When to use Gemini vs Claude

| Use Gemini when | Use Claude when |
|-----------------|-----------------|
| You want a second opinion or adversarial review | You are implementing changes |
| You're designing UI/UX or reviewing copy | You need structured code edits |
| You need alternative reasoning or critique | You are orchestrating workflows |
| You want visual/screenshot analysis | You need to read/write project files |

**Best workflow:** Gemini critiques → Claude executes → repeat.

## Commands

### Analysis commands (Gemini observes and reports)

| Command | Description |
|---------|-------------|
| `/gemini:ask <question>` | Ask Gemini a question or get a second opinion |
| `/gemini:review [focus]` | Code review using git diff |
| `/gemini:adversarial-review [focus]` | Hostile code review — assumes bugs exist |
| `/gemini:ui-review [focus]` | UI/UX defect review (ruthless critic) |

### Solution commands (Gemini proposes or structures outcomes)

| Command | Description |
|---------|-------------|
| `/gemini:ui-design [brief]` | Opinionated UI design suggestions with concrete values |
| `/gemini:task <prompt>` | Structured solution output for a specific goal |

### Job management

| Command | Description |
|---------|-------------|
| `/gemini:setup` | Check Gemini CLI availability and auth status |
| `/gemini:status [job-id]` | Show active and recent background jobs |
| `/gemini:result [job-id]` | Show finished job output |
| `/gemini:cancel [job-id]` | Cancel an active background job |

## UI commands

Two distinct modes — don't mix them up:

- **`/gemini:ui-review`** → **Critic mode.** Finds defects. No praise, no suggestions. Severity-tagged findings only.
- **`/gemini:ui-design`** → **Architect mode.** Generates improvements or new designs. Concrete values (hex, px, rem, Tailwind classes). Opinionated, not exploratory.

## Command selection guide

- `/gemini:ask` — second opinion, copy, wording, architecture questions
- `/gemini:review` — normal code review from git diff
- `/gemini:adversarial-review` — hostile review assuming bugs or weaknesses exist
- `/gemini:ui-review` — find UI/UX, accessibility, and interaction defects
- `/gemini:ui-design` — generate design improvements or new UI directions
- `/gemini:task` — delegate a broader structured task to Gemini

## Task prompt best practice

`/gemini:task` is the most powerful command but also the most open-ended. For best results, structure prompts with Goal, Context, Constraints, and Done condition:

```
/gemini:task --model pro "
Goal: Generate test cases for the webhook handler
Context: Node.js/Express app receiving Stripe webhooks
Constraints: Cover signature validation, idempotency, retries, and partial failures
Done when: Concise set of high-value test cases grouped by scenario
"
```

- State the goal, not just the topic
- Include constraints (stack, conventions, existing code)
- Define what "done" looks like
- Use `--model pro` for complex reasoning tasks

### Examples

```
# Ask anything
/gemini:ask "What's the best caching strategy for this API?"

# Code review
/gemini:review security
/gemini:review --background --base main --scope branch
/gemini:adversarial-review "authentication flow"

# UI/UX defect review — finds problems
/gemini:ui-review "form usability"
/gemini:ui-review --file login.blade.php "accessibility"
/gemini:ui-review --file screenshot.png "mobile layout"
/gemini:ui-review --background "full audit"
/gemini:ui-review --file /tmp/dashboard.png --background "mobile hierarchy and CTA clarity"

# UI design — generates improvements and new designs
/gemini:ui-design "Design a modern payment confirmation page with order summary"
/gemini:ui-design --file /tmp/dashboard.png --model pro "Keep the structure but redesign the cards for better scanability"
/gemini:ui-design --file screenshot.png "Keep the layout but make it feel premium"
/gemini:ui-design --file dashboard.blade.php "Modernise the sidebar navigation"
/gemini:ui-design --model pro "Design a settings page with profile, notifications, and billing tabs"

# Structured tasks
/gemini:task "Goal: Write migration plan for users table. Context: PostgreSQL, production. Constraints: zero downtime. Done when: step-by-step SQL + rollback plan."
/gemini:task --model pro "Goal: Design caching strategy. Context: Redis available, 10k RPM. Done when: cache keys, TTLs, invalidation rules defined."

# Background job management
/gemini:status
/gemini:result
/gemini:cancel
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
| `--yolo` | task | Auto-approve Gemini tool use (see warning below) |
| `--json` | setup, status, result | JSON output |
| `--all` | status | Show full job history |

### `--yolo` warning

Auto-approves Gemini tool execution with no confirmation, including file edits and shell commands. Use only in trusted, well-scoped tasks and only when your work is saved.

### Model Aliases

| Alias | Model |
|-------|-------|
| `pro` | gemini-3.1-pro-preview |
| `flash` | gemini-3-flash-preview |
| `25pro` | gemini-2.5-pro |
| `25flash` | gemini-2.5-flash |
| `lite` | gemini-2.5-flash-lite |

## Context guidelines

- **Prefer focused inputs over dumping entire repos.** A 500-line diff gets better analysis than a 10,000-line one.
- **Large diffs may degrade response quality.** Gemini prioritises recent tokens — older parts of long stdin payloads may get less attention.
- **Use `--file` + focused prompts for best results.** One component file beats a full git diff.
- **Screenshots work best for UI commands.** Gemini's vision is strong — use Playwright to capture specific elements rather than full pages.

## Playwright integration

Use Claude Code's [Playwright plugin](https://github.com/anthropics/claude-plugins-official) to capture screenshots of your running app, then feed them to Gemini for visual review or design suggestions.

### Workflow

1. **Take a screenshot** with Playwright:
```
Use Playwright to navigate to http://localhost:8000/login and take a screenshot
```
Playwright saves the screenshot (e.g. `/tmp/screenshot.png`).

2. **Review it** — find UI/UX defects:
```
/gemini:ui-review --file /tmp/screenshot.png "login page accessibility and mobile"
```

3. **Or redesign it** — get design improvements:
```
/gemini:ui-design --file /tmp/screenshot.png "Modernise this login page"
```

4. **Iterate** — implement the suggestions, take a new screenshot, review again.

### Tips

- Playwright can screenshot specific elements: ask it to capture just the navbar, a form, or a modal for focused review.
- Use `--background` for large pages so Gemini can analyse without blocking your session.
- Combine with code: ask Claude to read the component file, then pass both the screenshot and code context to Gemini for a complete picture.

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
prompts/*.md                        # Command-specific prompt templates with {{variable}} interpolation
skills/                             # Reusable Claude Code skills used by commands
agents/                             # Optional agent definitions for delegated workflows
```

### How it works

- **Foreground commands** spawn `gemini` as a child process in non-interactive mode, pipe large payloads (git diffs, file contents) via stdin to avoid OS argument limits, and return the response to Claude Code.
- **Background commands** (`--background`) spawn a detached worker process that writes results to disk. Use `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to manage them.
- **Session hooks** set a session ID on start and clean up stale jobs on end.
- **Prompt templates** are tuned for terminal output — structured bullets, no fluff, severity-tagged findings.

## License

MIT