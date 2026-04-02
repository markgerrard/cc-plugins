---
name: gemini-result-handling
description: Guidelines for presenting Gemini output back to the user
---

# Gemini Result Handling

When you receive output from any Gemini command (`/gemini:ask`, `/gemini:review`, `/gemini:ui-review`, `/gemini:adversarial-review`, `/gemini:task`, `/gemini:result`), always present it using this structure:

## Presentation format

1. **Question asked** — Summarize what was sent to Gemini (1-2 lines)
2. **Gemini's answer** — Present verbatim. Do not truncate, rewrite, or reorder.
3. **My interpretation** — Your assessment:
   - Do you agree or disagree with each point? Why?
   - What context does Gemini lack? (project history, recent changes, architectural decisions)
   - Are any suggestions impractical given the current stack/constraints?
   - Flag any findings you can verify or refute by reading the actual code
4. **Recommended action** — What should the user actually do?

## Key rules

- **Gemini advises, Claude interprets, user decides.** Never auto-apply Gemini's suggestions.
- **Wait for user approval** before acting on any recommendation.
- **Be specific in your interpretation** — "I agree" or "I disagree" without reasoning is useless.

## Watch out for

- **Aesthetic suggestions**: Gemini is persuasive about UI/UX opinions that are subjective. Filter through actual product goals, not Gemini's design taste.
- **Over-engineering**: Gemini may suggest abstractions, patterns, or refactors beyond what the task requires. Push back when simplicity is better.
- **Stale assumptions**: Gemini doesn't know the project history. It may flag something as a bug that's intentional, or suggest a pattern that was already tried and rejected.
- **False positives in reviews**: Especially in adversarial reviews, Gemini may flag theoretical issues that can't actually occur in the current codebase. Verify before alarming the user.

## Background jobs

When presenting results from `/gemini:result`:
- Include the job ID and duration for context
- Present the full output — do not summarize unless the user asks
- If the job failed, show the error and suggest next steps (retry, check logs, etc.)

## Model-specific notes

- `flash` responses are faster but shallower — good for quick checks
- `pro` responses are more thorough — better for reviews and complex tasks
- When the user hasn't specified a model, don't second-guess the default
