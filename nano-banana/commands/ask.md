---
description: Ask Gemini a question (text-only, for creative direction)
argument-hint: '[--background] [--model <model>] <question>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

General Gemini text query. Use this for creative direction, prompt engineering advice, or getting Gemini's perspective on visual concepts before generating images.

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **Gemini's answer** (verbatim)
3. **My interpretation** (agree/disagree, caveats)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" ask $ARGUMENTS
```
