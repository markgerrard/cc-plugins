---
description: Run a code review via Gemini using git diff
argument-hint: '[--background|--wait] [--base <ref>] [--scope auto|working-tree|branch] [focus area]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
---

Send the current git diff to Gemini for code review.

Options:
- `--base <ref>` — Base ref for diff (default: HEAD)
- `--scope auto|working-tree|branch` — What to diff (default: auto)
- `[focus area]` — Optional focus text (e.g. "security", "performance")

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **Gemini's review** (verbatim)
3. **My interpretation** (agree/disagree, context Gemini may have missed)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review $ARGUMENTS
```
