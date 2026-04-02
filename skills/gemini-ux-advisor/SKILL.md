---
name: gemini-ux-advisor
description: Use Gemini as a UI/UX advisor for design decisions, form layouts, error messages, and accessibility
---

# Gemini UX Advisor

When the user asks for UI/UX advice or mentions Gemini should handle UI planning:

1. Gather relevant UI artifacts (components, routes, copy, constraints)
2. Use `/gemini:ui-review` or `/gemini:ask` with a structured prompt
3. After receiving Gemini's response:
   - Enforce structure and scope
   - Remove out-of-scope suggestions
   - Add implementation notes specific to the project stack
   - Highlight assumptions Gemini made
4. Present the plan + assumptions to user and wait for approval

**Key rule:** Gemini proposes the UX content. Claude enforces constraints and makes it executable. User approves.

## When to use Gemini vs Codex

| Topic | Use |
|-------|-----|
| UI flows, forms, UX clarity | Gemini |
| Error messages, copy, wording | Gemini |
| Accessibility, affordances | Gemini |
| Backend logic, performance | Codex |
| Schema design, concurrency | Codex |
| Security review | Codex |
