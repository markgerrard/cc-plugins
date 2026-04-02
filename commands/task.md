---
description: Delegate a general task to Gemini
argument-hint: '[--background|--wait] [--model <model>] [--yolo] <prompt>'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Bash(cat:*)
---

Delegate a general-purpose task to Gemini CLI. Useful for getting second opinions, generating content, or exploring approaches.

Options:
- `--model <model>` — Override the Gemini model
- `--yolo` — Auto-approve tool use in Gemini

After receiving the response, present it to the user with:
1. **Task delegated** (what was sent)
2. **Gemini's response** (verbatim)
3. **My interpretation** (agree/disagree, context Gemini may have missed)
4. **Recommended action**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task $ARGUMENTS
```
