---
description: Show the stored output for a finished MiniMax job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/minimax-companion.mjs" result $ARGUMENTS`

Present the full output to the user. Do not summarize or condense it.
