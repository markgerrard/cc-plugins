#!/usr/bin/env node

/**
 * gemini-companion.mjs — Main entry point for the Gemini plugin.
 *
 * Thin Node adapter that routes everything through the Python ACP runtime.
 *
 * Subcommands:
 *   setup              Check Gemini availability and configuration
 *   ask                Ask Gemini a question (with optional piped context)
 *   review             Run a code review via Gemini
 *   adversarial-review Run an adversarial/hostile code review
 *   ui-review          Run a UI/UX-focused review via Gemini
 *   ui-design          Creative UI design suggestions
 *   task               Delegate a general task to Gemini
 *   status             Show active and recent Gemini jobs
 *   result             Show the stored final output for a finished job
 *   cancel             Cancel an active background job
 *   logs               Show logs for a job
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./node/args.mjs";
import { callGeminiAcp, streamGeminiAcp } from "./node/gemini-acp-bridge.mjs";
import {
  renderResult, renderError, renderBackgroundLaunch,
  renderStatusList, renderSingleJobStatus, renderSetup,
} from "./node/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ─── Helpers (stay in Node) ────────────────────────────────────────

function readStdinIfPiped() {
  try {
    if (!process.stdin.isTTY) {
      return fs.readFileSync(0, "utf8");
    }
  } catch {
    // fd 0 not readable
  }
  return null;
}

function getGitDiff(base = "HEAD", scope = "auto") {
  const args = ["diff"];
  if (scope === "branch") {
    args.push(`${base}...HEAD`);
  } else if (scope === "working-tree") {
    // unstaged changes only
  } else {
    // auto: staged + unstaged vs base
    args.push(base);
  }

  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });

  if (result.status !== 0 || !result.stdout?.trim()) {
    return null;
  }
  return result.stdout;
}

function readFileContext(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadPromptTemplate(name) {
  const templatePath = path.join(ROOT_DIR, "prompts", `${name}.md`);
  return fs.readFileSync(templatePath, "utf8");
}

function interpolate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── Prompt builders ───────────────────────────────────────────────

function buildAskPrompt(flags, positional) {
  const question = positional.join(" ");
  if (!question) {
    console.error("No question provided.\nUsage: /gemini:ask <question>");
    process.exit(1);
  }
  const stdin = readStdinIfPiped();
  if (stdin) {
    return `${question}\n\n---\n\n${stdin}`;
  }
  return question;
}

function buildReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "general code review";
  const base = flags.base || "HEAD";
  const scope = flags.scope || "auto";

  const diff = getGitDiff(base, scope);
  if (!diff) return null;

  let prompt;
  try {
    const template = loadPromptTemplate("code-review");
    prompt = interpolate(template, { focus });
  } catch {
    prompt = `You are an expert code reviewer. Review the following git diff.\n\nFocus: ${focus}\n\nProvide:\n1. **Critical issues** — bugs, security problems, data loss risks\n2. **Important suggestions** — performance, maintainability, best practices\n3. **Minor notes** — style, naming, documentation\n\nBe specific: reference file names and line numbers from the diff.`;
  }
  return `${prompt}\n\n---\n\n${diff}`;
}

function buildAdversarialReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "find all bugs and security issues";
  const base = flags.base || "HEAD";
  const scope = flags.scope || "auto";

  const diff = getGitDiff(base, scope);
  if (!diff) return null;

  let prompt;
  try {
    const template = loadPromptTemplate("adversarial-review");
    prompt = interpolate(template, { focus });
  } catch {
    prompt = `You are a hostile, adversarial code reviewer. Assume bugs exist. Review the following diff for security holes, race conditions, edge cases, data integrity issues, and failure modes. Be specific — file:line references, exploit scenarios, concrete fixes. Do NOT pad with praise.\n\nFocus: ${focus}`;
  }
  return `${prompt}\n\n---\n\n${diff}`;
}

function buildUiReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "general UI/UX review";
  let context = "";

  if (flags.file) {
    const content = readFileContext(flags.file);
    if (content) {
      context = `File: ${flags.file}\n${content}`;
    }
  }

  const stdin = readStdinIfPiped();
  if (stdin) {
    context += (context ? "\n\n" : "") + stdin;
  }

  if (!context) {
    const diff = getGitDiff();
    if (diff) context = diff;
  }

  let prompt;
  try {
    const template = loadPromptTemplate("ui-review");
    prompt = interpolate(template, { focus });
  } catch {
    prompt = `You are an expert UI/UX reviewer. Review the content provided for usability, accessibility, clarity, and user experience.\n\nFocus: ${focus}\n\nProvide feedback on:\n1. **UX flow** — Is the user journey clear and intuitive?\n2. **Accessibility** — WCAG compliance, screen readers, keyboard nav\n3. **Copy & messaging** — Error messages, labels, help text clarity\n4. **Visual hierarchy** — Layout, spacing, affordances\n5. **Edge cases** — Empty states, loading states, error states\n\nBe specific and actionable.`;
  }

  if (context) {
    return `${prompt}\n\n---\n\n${context}`;
  }
  return prompt;
}

function buildUiDesignPrompt(flags, positional) {
  const focus = positional.join(" ") || "redesign the entire interface";
  let context = "";

  if (flags.file) {
    const content = readFileContext(flags.file);
    if (content) {
      context = `File: ${flags.file}\n${content}`;
    }
  }

  const stdin = readStdinIfPiped();
  if (stdin) {
    context += (context ? "\n\n" : "") + stdin;
  }

  let prompt;
  try {
    const template = loadPromptTemplate("ui-design");
    prompt = interpolate(template, { focus });
  } catch {
    prompt = `You are a creative UI/UX designer. Provide opinionated, specific design suggestions.\n\nFocus: ${focus}\n\nBe specific — name exact colors (hex), spacing, fonts, layouts. Every suggestion must be implementable in CSS/HTML.`;
  }

  if (context) {
    return `${prompt}\n\n---\n\n${context}`;
  }
  return prompt;
}

function buildTaskPrompt(flags, positional) {
  const taskPrompt = positional.join(" ");
  if (!taskPrompt) {
    console.error("No task prompt provided.\nUsage: /gemini:task <prompt>");
    process.exit(1);
  }

  const stdin = readStdinIfPiped();
  if (stdin) {
    return `${taskPrompt}\n\n---\n\n${stdin}`;
  }
  return taskPrompt;
}

// ─── Prompt builder dispatch ───────────────────────────────────────

const PROMPT_BUILDERS = {
  ask: buildAskPrompt,
  review: buildReviewPrompt,
  "adversarial-review": buildAdversarialReviewPrompt,
  "ui-review": buildUiReviewPrompt,
  "ui-design": buildUiDesignPrompt,
  task: buildTaskPrompt,
};

// ─── Command handlers ──────────────────────────────────────────────

async function runPromptCommand(command, flags, positional) {
  const builder = PROMPT_BUILDERS[command];
  if (!builder) {
    console.error(`Unknown prompt command: ${command}`);
    process.exit(1);
  }

  const prompt = builder(flags, positional);
  if (prompt === null) {
    console.log("No changes found to review.");
    return;
  }

  // Build args array for the ACP bridge
  const args = [prompt];
  if (flags.model) { args.push("--model", flags.model); }
  if (flags.background) { args.push("--background"); }
  if (flags.stream) { args.push("--stream"); }
  if (flags.resume) { args.push("--resume", flags.resume); }

  // Streaming mode
  if (flags.stream) {
    console.error(`[gemini] Streaming ${command}...`);
    let fullText = "";
    for await (const event of streamGeminiAcp(command, args)) {
      if (event.type === "text_delta" && event.text) {
        process.stderr.write(event.text);
        fullText += event.text;
      }
      if (event.terminal) {
        const rendered = event.ok !== false
          ? renderResult(event)
          : renderError(event);
        console.log("");
        console.log(rendered);
        break;
      }
    }
    return;
  }

  // Background mode
  if (flags.background) {
    console.error(`[gemini] Launching ${command} in background...`);
    const { ok, data } = await callGeminiAcp(command, args);
    console.log(renderBackgroundLaunch(data));
    return;
  }

  // Foreground (default)
  console.error(`[gemini] Running ${command}...`);
  const { ok, data, exitCode } = await callGeminiAcp(command, args);

  if (ok) {
    console.log(renderResult(data));
  } else {
    console.error(renderError(data));
    process.exit(exitCode || 1);
  }
}

async function cmdSetup() {
  const { ok, data } = await callGeminiAcp("setup");
  console.log(renderSetup(data));
  if (!ok) {
    process.exit(1);
    return;
  }
  // Auto-warm the pool on successful setup
  console.error("[gemini] Warming ACP pool...");
  const pool = await callGeminiAcp("pool-warm");
  if (pool.ok) {
    console.error("[gemini] Pool warm — subsequent calls will be fast.");
  } else {
    console.error("[gemini] Pool warm failed — will use cold start.");
  }
}

async function cmdStatus(flags, positional) {
  const args = [];
  if (positional[0]) args.push(positional[0]);
  if (flags.all) args.push("--all");
  if (flags.json) args.push("--json");

  const { ok, data } = await callGeminiAcp("status", args);

  if (positional[0]) {
    console.log(renderSingleJobStatus(data));
  } else {
    console.log(renderStatusList(data));
  }
  if (!ok) process.exit(1);
}

async function cmdResult(flags, positional) {
  const args = [];
  if (positional[0]) args.push(positional[0]);
  if (flags.json) args.push("--json");

  const { ok, data } = await callGeminiAcp("result", args);

  if (ok) {
    console.log(renderResult(data));
  } else {
    console.error(renderError(data));
    process.exit(1);
  }
}

async function cmdCancel(flags, positional) {
  const args = [];
  if (positional[0]) args.push(positional[0]);
  if (flags.json) args.push("--json");

  const { ok, data } = await callGeminiAcp("cancel", args);

  if (ok) {
    console.log(data.message || `Job ${positional[0] || ""} cancelled.`);
  } else {
    console.error(renderError(data));
    process.exit(1);
  }
}

async function cmdLogs(flags, positional) {
  const args = [];
  if (positional[0]) args.push(positional[0]);
  if (flags.json) args.push("--json");

  const { ok, data, stderr } = await callGeminiAcp("logs", args);

  if (ok) {
    console.log(data.text || data.logs || JSON.stringify(data, null, 2));
  } else {
    console.error(renderError(data));
    process.exit(1);
  }
}

// ─── Usage ─────────────────────────────────────────────────────────

function printUsage() {
  console.log(
    [
      "Usage:",
      "  gemini-companion.mjs setup",
      "  gemini-companion.mjs ask [--background|--stream] [--model <model>] <question>",
      "  gemini-companion.mjs review [--background|--stream] [--base <ref>] [--scope <auto|working-tree|branch>] [focus]",
      "  gemini-companion.mjs adversarial-review [--background|--stream] [--base <ref>] [--scope <auto|working-tree|branch>] [focus]",
      "  gemini-companion.mjs ui-review [--background|--stream] [--file <path>] [focus]",
      "  gemini-companion.mjs ui-design [--background|--stream] [--file <path>] [--model <model>] [design brief]",
      "  gemini-companion.mjs task [--background|--stream] [--model <model>] <prompt>",
      "  gemini-companion.mjs status [job-id] [--all] [--json]",
      "  gemini-companion.mjs result [job-id] [--json]",
      "  gemini-companion.mjs cancel [job-id] [--json]",
      "  gemini-companion.mjs logs [job-id] [--json]",
    ].join("\n")
  );
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    printUsage();
    process.exit(0);
  }

  const subcommand = rawArgs[0];
  const { flags, positional } = parseArgs(rawArgs.slice(1));

  switch (subcommand) {
    case "setup":
      await cmdSetup();
      break;

    case "ask":
    case "review":
    case "adversarial-review":
    case "ui-review":
    case "ui-design":
    case "task":
      await runPromptCommand(subcommand, flags, positional);
      break;

    case "status":
      await cmdStatus(flags, positional);
      break;

    case "result":
      await cmdResult(flags, positional);
      break;

    case "cancel":
      await cmdCancel(flags, positional);
      break;

    case "logs":
      await cmdLogs(flags, positional);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
