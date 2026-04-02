---
name: grok-result-handling
description: Guidelines for presenting Grok output back to the user
---

# Grok Result Handling

When you receive output from any Grok command, present it using this structure:

1. **Topic/question** — What was sent to Grok (1-2 lines)
2. **Grok's response** — Present verbatim. Do not truncate or rewrite.
3. **My interpretation** — Your assessment:
   - Is this a strong or weak signal? Why?
   - What context does Grok lack? (product history, strategy, private data)
   - Are any claims unverifiable or suspiciously neat?
   - What's actionable vs noise?
4. **Recommended next step** — What should the user do with this?

## Key rules

- **Grok scans, Claude interprets, user decides.** Never auto-act on sentiment data.
- **Wait for user approval** before proceeding.
- **Distinguish signal from noise** — Grok may surface vocal minorities or irrelevant threads.

## Watch out for

- **Volume vs intensity**: Lots of posts ≠ strong sentiment. A few intense posts ≠ broad consensus.
- **Prompt-shaped conclusions**: Grok will find what you ask it to find. If you ask "is X failing?", it will find failure signals.
- **Non-repeatable results**: Running the same query twice may surface different posts. Flag this to users.
- **Selection bias**: X skews certain demographics. Don't treat it as representative market research.
