---
description: View Gemini job event log
argument-hint: '[--job <job_id>] [--text]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" logs $ARGUMENTS`

Show the event log for a Gemini job.
