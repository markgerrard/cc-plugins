---
description: Delegate a coding task to Grok via Pi coding agent (has file access)
argument-hint: '[--model <model>] <task>'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(pi:*)
---

Runs Pi coding agent with Grok as the model. Unlike `/grok:ask`, this command gives Grok full file access — it can read, write, edit files and run bash commands in the project.

Use for implementation tasks, not analysis.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" code $ARGUMENTS
```
