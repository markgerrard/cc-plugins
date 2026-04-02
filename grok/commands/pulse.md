---
description: Quick directional read on what X is saying about a topic
argument-hint: '[--background] [--model <model>] <topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Fast pulse check — direction, volume, trend, key reactions, one-line takeaway.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" pulse $ARGUMENTS
```
