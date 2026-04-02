---
description: Cancel an active background MiniMax job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" cancel $ARGUMENTS`
