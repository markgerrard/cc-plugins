---
name: minimax-result-handling
description: Guidelines for presenting MiniMax output back to the user
---

# MiniMax Result Handling

When you receive output from any MiniMax command, present it using this structure:

1. **Topic/question** — What was sent to MiniMax (1-2 lines)
2. **MiniMax's response** — Present verbatim. Do not truncate or rewrite.
3. **My interpretation** — Your assessment:
   - Is the analysis thorough or superficial? Why?
   - What context does MiniMax lack? (codebase history, product constraints, team conventions)
   - Are any suggestions impractical or over-engineered?
   - What's actionable vs noise?
4. **Recommended next step** — What should the user do with this?

## Key rules

- **MiniMax advises, Claude interprets, user decides.** Never auto-act on MiniMax output.
- **Wait for user approval** before proceeding with any suggested changes.
- **Distinguish insight from boilerplate** — MiniMax may produce generic advice alongside genuine findings.

## Watch out for

- **Reasoning model verbosity**: MiniMax-M1 and MiniMax-M2 are reasoning models that may produce long chains of thought. Extract the key conclusions.
- **Prompt-shaped conclusions**: MiniMax will find what you ask it to find. If you ask "are there bugs?", it will find concerns even in clean code.
- **Missing context**: MiniMax only sees what you send it (the diff, the question). It does not know your test suite, CI pipeline, or deployment constraints.
- **Over-engineering suggestions**: Watch for suggestions that add complexity without proportional benefit.
