---
description: Generate creative variations of an existing image
argument-hint: '[--background] [--model <model>] --file <image>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Generate a creative variation of an existing image. The model will keep the core subject and composition while exploring different styles, colors, lighting, or artistic interpretations.

After receiving the variation, tell the user:
1. **Source image** used
2. **File path** of the variation
3. **How it differs** from the original

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" variations $ARGUMENTS
```
