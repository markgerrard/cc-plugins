---
description: Ask Grok a question with X search enabled
argument-hint: '[--background] [--model <model>] [--web] <question>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

General Grok query with X search enabled by default. Add --web to also enable web search.

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **Grok's answer** (verbatim)
3. **My interpretation** (agree/disagree, caveats)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" ask $ARGUMENTS
```
