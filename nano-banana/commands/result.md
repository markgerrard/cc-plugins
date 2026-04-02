---
description: Show the stored output for a finished Banana job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" result $ARGUMENTS`

Present the full output to the user. Do not summarize or condense it. If an image was generated, show the file path.
