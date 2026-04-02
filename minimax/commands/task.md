---
description: Delegate a structured task to MiniMax
argument-hint: '[--background] [--model <model>] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Structured task delegation to MiniMax. Good for code generation, analysis, refactoring plans, and research tasks.

After receiving the response, present it to the user with:
1. **Task sent** (what was delegated)
2. **MiniMax's output** (verbatim)
3. **My interpretation** (quality assessment, anything missed, corrections needed)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" task $ARGUMENTS
```
