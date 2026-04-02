---
description: Show active and recent MiniMax jobs
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" status $ARGUMENTS`
