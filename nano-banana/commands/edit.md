---
description: Edit an existing image with Gemini based on text instructions
argument-hint: '[--background] [--model <model>] --file <image> <edit instructions>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Edit or modify an existing image using Gemini. Provide the source image with `--file` and describe the desired changes.

After receiving the edited image, tell the user:
1. **Source image** and **edit instructions** used
2. **File path** of the edited image
3. **What changed** vs the original

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" edit $ARGUMENTS
```
