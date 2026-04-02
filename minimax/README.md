# MiniMax Plugin for Claude Code

A Claude Code plugin that brings MiniMax AI into your workflow for reasoning, long-context analysis, code review, and structured task delegation.

**Operating model:** MiniMax advises, Claude interprets, user decides.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- MiniMax API key from [platform.minimax.io](https://platform.minimax.io)
- Node.js 18+

Set your API key:
```bash
export MINIMAX_API_KEY=your_key_here
```

## Installation

**Recommended:** Use the [claude-code-llm-plugins](https://github.com/markgerrard/claude-code-llm-plugins) monorepo:

```bash
git clone https://github.com/markgerrard/claude-code-llm-plugins.git
cd claude-code-llm-plugins
./install.sh minimax
```

Restart Claude Code to load the plugin.

## When to use MiniMax

| Use MiniMax when | Use other tools when |
|------------------|---------------------|
| You want a second opinion on code changes | You need real-time web/social data (use Grok) |
| You need long-context reasoning over large diffs | You need UI/UX review (use Gemini) |
| You want structured task delegation | You need code execution or tool use |
| You need a different reasoning perspective | You need the latest web information |

MiniMax excels at **reasoning, long-context analysis, and structured tasks**. MiniMax-M2 is a flagship reasoning model with strong performance on complex problems.

## Commands

| Command | Description |
|---------|-------------|
| `/minimax:ask <question>` | General query — reasoning, analysis, creative tasks |
| `/minimax:task <prompt>` | Structured task delegation — code gen, refactoring plans, research |
| `/minimax:review [--focus <area>]` | Code review via git diff (piped stdin) |
| `/minimax:setup` | Check API key and connectivity |
| `/minimax:status [job-id]` | Show active and recent background jobs |
| `/minimax:result [job-id]` | Show finished job output |
| `/minimax:cancel [job-id]` | Cancel an active background job |

### Examples

```
# General questions
/minimax:ask "What are the tradeoffs between event sourcing and CQRS?"
/minimax:ask --model pro "Analyse this architecture for scalability concerns"

# Structured tasks
/minimax:task "Generate a migration plan from Express to Fastify"
/minimax:task --background "Write comprehensive test cases for the auth module"

# Code review
/minimax:review
/minimax:review --focus "security"
/minimax:review --focus "performance and N+1 queries"

# Background jobs
/minimax:task --background "Audit all error handling in the codebase"
/minimax:status
/minimax:result
```

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `--background` | ask, task, review | Run in background, returns job ID |
| `--model <model>` | ask, task, review | Override the model (or use alias) |
| `--focus <area>` | review | Focus the code review on a specific area |
| `--json` | setup, status, result | JSON output |
| `--all` | status | Show full job history |

### Model Aliases

| Alias | Model | Notes |
|-------|-------|-------|
| `fast` / `text` | MiniMax-Text-01 | Non-reasoning, fastest, cheapest |
| `reasoning` / `m1` | MiniMax-M1 | Reasoning model (default) |
| `pro` / `flagship` / `m2` | MiniMax-M2 | Flagship reasoning model, strongest |

## Architecture

```
.claude-plugin/plugin.json          # Plugin manifest
commands/*.md                       # Slash command definitions
scripts/minimax-companion.mjs       # Main entry point — routes subcommands
scripts/lib/
  minimax.mjs                       # MiniMax API client, model aliases
  args.mjs                          # Argument parsing
  state.mjs                         # File-based job persistence per workspace
  tracked-jobs.mjs                  # Job lifecycle tracking
  job-control.mjs                   # Job querying, filtering, resolution
  render.mjs                        # Output formatting for status/result/cancel
  process.mjs                       # Process tree termination
  workspace.mjs                     # Git workspace root detection
scripts/session-lifecycle-hook.mjs  # Session start/end cleanup
hooks/hooks.json                    # Session lifecycle hook config
prompts/*.md                        # Command-specific prompt templates
skills/                             # Reusable Claude Code skills
```

### How it works

- **No CLI dependency.** This plugin calls the MiniMax API directly via HTTP (`https://api.minimax.io/v1/chat/completions`), OpenAI-compatible format.
- **Reasoning models.** MiniMax-M1 and MiniMax-M2 are reasoning models — they think through problems step by step before answering.
- **Background jobs** spawn detached worker processes that write results to disk, same pattern as the Grok and Gemini plugins.
- **Review via stdin.** The review command reads git diff from stdin to avoid E2BIG errors on large diffs.

## License

MIT
