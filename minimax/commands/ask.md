---
description: Ask MiniMax a question
argument-hint: '[--background] [--model <model>] <question>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

General MiniMax query. Good for reasoning, long-context analysis, and creative tasks.

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **MiniMax's answer** (verbatim)
3. **My interpretation** (agree/disagree, caveats)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" ask $ARGUMENTS
```
