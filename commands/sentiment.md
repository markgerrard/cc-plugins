---
description: Scan X/Twitter sentiment on a topic via Grok
argument-hint: '[--background] [--model <model>] [--from <date>] [--to <date>] <topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Search X for a topic and produce a sentiment analysis covering themes, objections, positive reception, notable voices, and representative posts.

After receiving the response, present it to the user with:
1. **Topic scanned** (what was sent)
2. **Grok's analysis** (verbatim)
3. **My interpretation** (what's actionable, what to watch, caveats)
4. **Recommended next step**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" sentiment $ARGUMENTS
```
