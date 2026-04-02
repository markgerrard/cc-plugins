---
description: Code review using MiniMax via git diff
argument-hint: '[--background] [--model <model>] [--focus <area>] [focus]'
disable-model-invocation: true
allowed-tools: Bash(node:*,git:*)
---

Code review powered by MiniMax. Pipes git diff via stdin to avoid E2BIG errors on large diffs.

After receiving the response, present it to the user with:
1. **What was reviewed** (scope of the diff)
2. **MiniMax's review** (verbatim)
3. **My interpretation** (agree/disagree with findings, additional context)
4. **Recommended action**

```bash
git diff | node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" review $ARGUMENTS
```

If the user specifies a base branch or commit range, adjust the git diff command accordingly:
```bash
git diff main...HEAD | node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" review $ARGUMENTS
```

For staged changes only:
```bash
git diff --cached | node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" review $ARGUMENTS
```
