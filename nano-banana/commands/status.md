---
description: Show active and recent Banana image generation jobs
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" status $ARGUMENTS`
