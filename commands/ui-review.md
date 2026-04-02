---
description: Run a UI/UX review via Gemini
argument-hint: '[--background|--wait] [--file <path>] [focus area]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(cat:*)
---

Send UI components or templates to Gemini for UI/UX review.

Options:
- `--file <path>` — Specific file to review
- `[focus area]` — Optional focus (e.g. "form usability", "error messages", "accessibility")

If no file is specified, falls back to git diff.

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **Gemini's review** (verbatim)
3. **My interpretation** (agree/disagree, context Gemini may have missed)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" ui-review $ARGUMENTS
```
