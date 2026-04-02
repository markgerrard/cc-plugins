---
description: Get creative UI design suggestions from Gemini — for new builds or improving existing UI
argument-hint: '[--background|--wait] [--file <path>] [--model <model>] [design brief or focus]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(cat:*)
---

Get opinionated, creative UI/UX design suggestions from Gemini. Unlike `/gemini:ui-review` (which finds defects), this command generates design improvements and ideas.

Supports:
- Screenshots: `--file mockup.png` — Gemini will analyze and suggest improvements
- Code files: `--file login.blade.php` — suggests visual/UX upgrades
- Text briefs: just describe what you want to build
- Combination: provide a screenshot + describe what to change

Examples:
- `/gemini:ui-design "Design a modern login page with social auth"` — from scratch
- `/gemini:ui-design --file screenshot.png "Keep the layout but make it feel more premium"` — improve existing
- `/gemini:ui-design --file dashboard.blade.php "Modernise the sidebar navigation"` — upgrade code

After receiving the response, present it to the user with:
1. **Brief sent** (what was sent to Gemini)
2. **Gemini's suggestions** (verbatim)
3. **My interpretation** (feasibility, what to prioritise, any stack-specific notes)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" ui-design $ARGUMENTS
```
