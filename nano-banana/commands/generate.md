---
description: Generate an image from a text prompt using Gemini
argument-hint: '[--background] [--model <model>] [--aspect <ratio>] [--size <size>] <prompt>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Generate an image from a text description using Google Gemini's native image generation.

Options:
- `--model <alias>` — `pro` (gemini-2.5-pro-preview-06-05) or `flash` (gemini-2.0-flash-exp, default)
- `--aspect <ratio>` — `1:1`, `16:9`, `4:3`, `3:2`, `2:3`, `9:16`
- `--size <size>` — `512`, `1K`, `2K`, `4K`
- `--background` — Run asynchronously

After receiving the image, tell the user:
1. **Prompt used** (what was sent)
2. **File path** of the generated image
3. **Suggestions** for refinement if the result could be improved

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/banana-companion.mjs" generate $ARGUMENTS
```
