---
name: banana-result-handling
description: Guidelines for presenting Nano Banana output back to the user
---

# Banana Result Handling

When you receive output from any Banana image generation command, present it using this structure:

## For image generation (`/banana:generate`, `/banana:edit`, `/banana:variations`)

1. **Prompt/instructions** -- What was sent to Gemini (1-2 lines)
2. **Result** -- The file path of the generated image, plus any text Gemini returned
3. **Assessment** -- Your evaluation:
   - Does the image appear to match the prompt?
   - Were there any safety filter issues?
   - Could the prompt be refined for better results?
4. **Suggested next steps** -- Refinements, edits, or variations the user might want

## For text queries (`/banana:ask`)

1. **Question** -- What was sent to Gemini (1-2 lines)
2. **Gemini's response** -- Present verbatim. Do not truncate or rewrite.
3. **My interpretation** -- Your assessment:
   - Is this good creative direction?
   - What context does Gemini lack?
   - Is the advice actionable?
4. **Recommended action** -- What should the user do with this?

## Key rules

- **Gemini generates, Claude presents, user decides.** Never auto-act on generated images.
- **Wait for user approval** before doing additional generations.
- **Show file paths** so the user can open and review images directly.
- **Suggest refinements** -- prompt engineering is iterative. Help the user get closer to what they want.

## Watch out for

- **Safety filters**: Gemini may refuse certain prompts. Suggest alternatives that preserve intent.
- **Model limitations**: Not all models support image generation equally. If one fails, suggest trying a different model alias.
- **Large files**: Generated images can be several MB. Note the file size if relevant.
- **Prompt specificity**: Vague prompts produce generic results. Encourage the user to be specific about style, composition, lighting, and subject.
