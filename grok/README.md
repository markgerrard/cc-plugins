# Grok Plugin for Claude Code

A Claude Code plugin that brings Grok into your workflow for real-time X/Twitter sentiment scanning, narrative analysis, and social signal discovery — powered by xAI's built-in X search.

**Operating model:** Grok scans, Claude interprets, user decides.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- xAI API key from [console.x.ai](https://console.x.ai)
- Node.js 18+

Set your API key:
```bash
export XAI_API_KEY=your_key_here
```

## Installation

**Recommended:** Use the [claude-code-llm-plugins](https://github.com/markgerrard/claude-code-llm-plugins) monorepo:

```bash
git clone https://github.com/markgerrard/claude-code-llm-plugins.git
cd claude-code-llm-plugins
./install.sh grok
```

Restart Claude Code to load the plugin.

## When to use Grok

| Use Grok when | Use other tools when |
|---------------|---------------------|
| You want a quick read on social reception | You need statistically reliable measurement |
| You're scanning for narratives, objections, angles | You need reproducible market research |
| You want to compare how two framings are landing | You need volume/share-of-voice tracking |
| You need representative posts on a topic | You need clean, unbiased sampling |

Grok gives you **qualitative signal discovery** from X. It is not a replacement for a proper sentiment analytics pipeline.

## Commands

| Command | Description |
|---------|-------------|
| `/grok:sentiment <topic>` | Full X sentiment analysis — themes, objections, reception, representative posts |
| `/grok:pulse <topic>` | Quick directional read — direction, volume, trend, one-line takeaway |
| `/grok:compare <A> vs <B>` | Compare reception of two topics/framings on X |
| `/grok:ask <question>` | General Grok query with X search enabled |
| `/grok:setup` | Check API key and connectivity |
| `/grok:status [job-id]` | Show active and recent background jobs |
| `/grok:result [job-id]` | Show finished job output |
| `/grok:cancel [job-id]` | Cancel an active background job |

## Command selection guide

- `/grok:pulse` — fast check, are people talking about this, which direction
- `/grok:sentiment` — deeper dive, themes and representative posts
- `/grok:compare` — A/B on two framings, products, or ideas
- `/grok:ask` — freeform question with X search context

### Examples

```
# Quick pulse check
/grok:pulse "Claude Code"
/grok:pulse "GPT-5 release"

# Deep sentiment scan
/grok:sentiment "React Server Components"
/grok:sentiment --from 2026-03-01 --to 2026-04-01 "Tailwind v4"
/grok:sentiment --background "AI code review tools"

# Compare two framings
/grok:compare "vibe coding" vs "AI-assisted development"
/grok:compare "Next.js" vs "Remix"

# General questions with X context
/grok:ask "What are developers saying about Cursor vs Claude Code?"
/grok:ask --web "Latest xAI announcements and developer reaction"

# Background jobs
/grok:sentiment --background "your competitor name"
/grok:status
/grok:result
```

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `--background` | all action commands | Run in background, returns job ID |
| `--model <model>` | all action commands | Override the Grok model (or use alias) |
| `--from <date>` | sentiment | Start date for X search (YYYY-MM-DD) |
| `--to <date>` | sentiment | End date for X search (YYYY-MM-DD) |
| `--web` | ask | Also enable web search alongside X search |
| `--json` | setup, status, result | JSON output |
| `--all` | status | Show full job history |

### Model Aliases

| Alias | Model | Notes |
|-------|-------|-------|
| `fast` | grok-4-1-fast-non-reasoning | Default. Cheapest, good for pulse/sentiment |
| `fast-reasoning` | grok-4-1-fast-reasoning | Budget reasoning |
| `pro` | grok-4.20-0309-non-reasoning | Flagship, deeper analysis |
| `reasoning` | grok-4.20-0309-reasoning | Flagship with reasoning chain |

## Context guidelines

- **Be specific with topics.** "React" is too broad. "React Server Components adoption" is better.
- **Use date ranges for sentiment.** Without `--from`/`--to`, Grok searches recent posts which may not capture the full picture.
- **Compare specific framings, not vague categories.** "vibe coding vs AI-assisted development" is better than "good AI vs bad AI".
- **X skews certain demographics.** Developer Twitter ≠ the market. Don't treat it as representative research.
- **Results are non-repeatable.** Running the same query twice may surface different posts. Use for directional signal, not measurement.

## Architecture

```
.claude-plugin/plugin.json          # Plugin manifest
commands/*.md                       # Slash command definitions
scripts/grok-companion.mjs          # Main entry point — routes subcommands
scripts/lib/
  grok.mjs                          # xAI API client, model aliases, x_search/web_search tools
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

- **No CLI dependency.** Unlike the Gemini plugin which wraps a CLI, this plugin calls the xAI API directly via HTTP (`https://api.x.ai/v1/responses`).
- **Built-in X search.** The xAI Responses API has a native `x_search` tool that searches X server-side. Grok queries X, reads the posts, and synthesises the analysis — all in one API call.
- **Background jobs** spawn detached worker processes that write results to disk, same pattern as the Gemini plugin.

## License

MIT