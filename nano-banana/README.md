# Nano Banana

Google Gemini image generation, served fresh from Claude Code.

Nano Banana wraps the Google Generative AI API's native image generation capabilities as Claude Code slash commands. Generate images from text prompts, edit existing images, create variations, and get creative direction -- all without leaving your terminal.

## Commands

| Command | What it does |
|---------|-------------|
| `/banana:generate <prompt>` | Generate an image from a text description |
| `/banana:edit --file <image> <prompt>` | Edit an existing image based on instructions |
| `/banana:variations --file <image>` | Generate creative variations of an image |
| `/banana:ask <question>` | General Gemini text query (creative direction, prompt advice) |
| `/banana:status [job-id]` | Show active and recent jobs |
| `/banana:result [job-id]` | Show finished job output |
| `/banana:cancel [job-id]` | Cancel an active background job |
| `/banana:setup` | Check API key and connectivity |

## Options

All image commands support these flags:

- `--model <alias>` -- Model selection: `pro` or `flash` (default)
- `--aspect <ratio>` -- Aspect ratio: `1:1`, `16:9`, `4:3`, `3:2`, `2:3`, `9:16`
- `--size <size>` -- Resolution: `512`, `1K`, `2K`, `4K`
- `--background` -- Run the job asynchronously

## Model Aliases

| Alias | Model ID |
|-------|----------|
| `flash` (default) | `gemini-2.0-flash-exp` |
| `pro` | `gemini-2.5-pro-preview-06-05` |

You can also pass a full model ID directly (e.g., `--model gemini-2.5-flash-image`).

## Setup

1. Get a Google API key at https://aistudio.google.com/apikey
2. Set the `GOOGLE_API_KEY` environment variable
3. Run `/banana:setup` to verify connectivity

## How It Works

- **Image generation** uses the Gemini `generateContent` endpoint with `responseModalities: ["TEXT", "IMAGE"]`
- **Image editing** sends the source image as `inline_data` alongside the edit prompt
- **Variations** use the edit pipeline with a built-in variation prompt
- Generated images are saved as PNG files in the current working directory with timestamped filenames (e.g., `banana-1711929600000.png`)
- All commands support background execution via `--background` for long-running generation tasks

## Architecture

```
scripts/
  banana-companion.mjs       Main router (setup, generate, edit, variations, ask, status, result, cancel)
  session-lifecycle-hook.mjs  Session start/end (job cleanup)
  lib/
    banana.mjs                Gemini API client (image gen, editing, text queries)
    args.mjs                  Argument parsing
    state.mjs                 File-based job persistence
    tracked-jobs.mjs          Job lifecycle tracking
    job-control.mjs           Job querying and filtering
    render.mjs                Output formatting
    process.mjs               Process tree management
    workspace.mjs             Git workspace detection
```

## Why "Nano Banana"?

The Gemini API docs literally use "nano banana" as an example image generation prompt. We leaned into it. The plugin is small (nano), the results are appealing (banana), and sometimes you just need a picture of a tiny banana in a fancy restaurant with a Gemini theme.
