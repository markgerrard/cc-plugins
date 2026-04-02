---
description: Ask Gemini a question or get a second opinion
argument-hint: '[--background|--wait] [--model <model>] <question>'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(cat:*)
---

Ask Gemini CLI a question. Supports piping file content as context.

Examples:
- `/gemini:ask "What's the best approach for caching this API response?"`
- `/gemini:ask --model gemini-2.5-pro "Review this error handling pattern"`

The command gathers the question from the arguments, optionally pipes stdin content for context, and returns Gemini's response.

After receiving the response, present it to the user with:
1. **Question asked** (what was sent)
2. **Gemini's answer** (verbatim)
3. **My interpretation** (agree/disagree, context Gemini may have missed)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" ask $ARGUMENTS
```
