#!/usr/bin/env node

/**
 * gemini-companion.mjs — Main entry point for the Gemini plugin.
 *
 * Subcommands:
 *   setup          Check Gemini CLI availability and login status
 *   ask            Ask Gemini a question (with optional piped context)
 *   review         Run a code review via Gemini
 *   ui-review      Run a UI/UX-focused review via Gemini
 *   task           Delegate a general task to Gemini
 *   status         Show active and recent Gemini jobs
 *   result         Show the stored final output for a finished job
 *   cancel         Cancel an active background job
 *   task-worker    Internal: run a background job (not user-facing)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getGeminiAvailability,
  runGeminiPrompt,
  loadPromptTemplate,
  interpolateTemplate,
} from "./lib/gemini.mjs";
import { getGitDiff, getGitLog, readFileContext, readStdinIfPiped } from "./lib/context.mjs";
import {
  generateJobId,
  upsertJob,
  writeJobFile,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  ensureStateDir,
} from "./lib/state.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobRecord,
  runTrackedJob,
  SESSION_ID_ENV,
  nowIso,
} from "./lib/tracked-jobs.mjs";
import {
  buildStatusSnapshot,
  buildSingleJobSnapshot,
  enrichJob,
  resolveResultJob,
  resolveCancelableJob,
  readStoredJob,
  sortJobsNewestFirst,
} from "./lib/job-control.mjs";
import {
  renderStatusReport,
  renderJobStatusReport,
  renderStoredJobResult,
  renderCancelReport,
} from "./lib/render.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { terminateProcessTree } from "./lib/process.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/gemini-companion.mjs setup [--json]",
      "  node scripts/gemini-companion.mjs ask [--background|--wait] [--model <model>] <question>",
      "  node scripts/gemini-companion.mjs review [--background|--wait] [--base <ref>] [--scope <auto|working-tree|branch>] [focus]",
      "  node scripts/gemini-companion.mjs ui-review [--background|--wait] [--file <path>] [focus]",
      "  node scripts/gemini-companion.mjs task [--background|--wait] [--model <model>] [--yolo] <prompt>",
      "  node scripts/gemini-companion.mjs ui-design [--background|--wait] [--file <path>] [--model <model>] [design brief]",
      "  node scripts/gemini-companion.mjs adversarial-review [--background|--wait] [--base <ref>] [--scope <auto|working-tree|branch>] [focus]",
      "  node scripts/gemini-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/gemini-companion.mjs result [job-id] [--json]",
      "  node scripts/gemini-companion.mjs cancel [job-id] [--json]",
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
}

// ─── Background job launcher ────────────────────────────────────────

function launchBackgroundWorker(jobId, kind, prompt, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const logFile = createJobLogFile(workspaceRoot, jobId, `${kind} job`);

  // Create initial job record
  const jobRecord = createJobRecord({
    id: jobId,
    kind,
    jobClass: kind,
    title: `${kind}: ${(options.title || prompt).slice(0, 60)}`,
    status: "queued",
    phase: "queued",
    workspaceRoot,
    logFile,
    prompt,
    model: options.model || null,
  });

  writeJobFile(workspaceRoot, jobId, {
    ...jobRecord,
    prompt,
    stdinPayload: options.stdinPayload || null,
    mediaFiles: options.mediaFiles || [],
  });
  upsertJob(workspaceRoot, jobRecord);

  // Spawn detached worker process
  const workerArgs = [
    SCRIPT_PATH,
    "task-worker",
    jobId,
    "--kind", kind,
  ];
  if (options.model) workerArgs.push("--model", options.model);
  if (options.yolo) workerArgs.push("--yolo");

  const child = spawn("node", workerArgs, {
    cwd: workspaceRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      GEMINI_WORKER_JOB_ID: jobId,
      GEMINI_WORKER_WORKSPACE: workspaceRoot,
    },
  });

  child.unref();

  // Update job with PID
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "starting", pid: child.pid });

  return { jobId, logFile, pid: child.pid, workspaceRoot };
}

// ─── setup ──────────────────────────────────────────────────────────

async function cmdSetup(flags) {
  const status = await getGeminiAvailability();

  const report = {
    geminiAvailable: status.available,
    version: status.version,
    error: status.error,
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = [];
    if (status.available) {
      lines.push(`Gemini CLI v${status.version} — ready.`);
      lines.push("");
      lines.push("Available commands:");
      lines.push("  /gemini:ask <question>              — Ask Gemini anything");
      lines.push("  /gemini:review [focus]               — Code review (uses git diff)");
      lines.push("  /gemini:ui-review [focus]            — UI/UX review");
      lines.push("  /gemini:task <prompt>                — Delegate a task to Gemini");
      lines.push("  /gemini:ui-design [brief]              — Creative UI design suggestions");
      lines.push("  /gemini:adversarial-review [focus]    — Hostile code review");
      lines.push("  /gemini:status [job-id]              — Show job status");
      lines.push("  /gemini:result [job-id]              — Show finished job result");
      lines.push("  /gemini:cancel [job-id]              — Cancel an active job");
      lines.push("");
      lines.push("All action commands support --background and --wait flags.");
    } else {
      lines.push("Gemini CLI is not available.");
      lines.push(`Error: ${status.error}`);
      lines.push("");
      lines.push("Install: npm install -g @google/gemini-cli");
      lines.push("Then run: gemini (to authenticate with Google)");
    }
    console.log(lines.join("\n"));
  }
}

// ─── Prompt builders ────────────────────────────────────────────────

async function buildAskPrompt(flags, positional) {
  const question = positional.join(" ");
  if (!question) throw new Error("No question provided.\nUsage: /gemini:ask <question>");

  const stdinContent = await readStdinIfPiped();
  if (stdinContent) {
    // Pipe large context via stdin, keep the question as the CLI arg
    return { prompt: question, stdinPayload: stdinContent, title: question };
  }
  return { prompt: question, title: question };
}

async function buildReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "general code review";
  const base = flags.base || "HEAD";
  const scope = flags.scope || "auto";

  const diff = await getGitDiff(base, scope);
  if (!diff) return { prompt: null, title: focus, empty: true };

  let prompt;
  try {
    const template = await loadPromptTemplate("code-review");
    prompt = interpolateTemplate(template, { focus });
  } catch {
    prompt = `You are an expert code reviewer. Review the git diff provided via stdin.\n\nFocus: ${focus}\n\nProvide:\n1. **Critical issues** — bugs, security problems, data loss risks\n2. **Important suggestions** — performance, maintainability, best practices\n3. **Minor notes** — style, naming, documentation\n\nBe specific: reference file names and line numbers from the diff.`;
  }
  return { prompt, stdinPayload: diff, title: `review: ${focus}` };
}

async function buildAdversarialReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "find all bugs and security issues";
  const base = flags.base || "HEAD";
  const scope = flags.scope || "auto";

  const diff = await getGitDiff(base, scope);
  if (!diff) return { prompt: null, title: focus, empty: true };

  let prompt;
  try {
    const template = await loadPromptTemplate("adversarial-review");
    prompt = interpolateTemplate(template, { focus });
  } catch {
    prompt = `You are a hostile, adversarial code reviewer. Assume bugs exist. Review the git diff provided via stdin for security holes, race conditions, edge cases, data integrity issues, and failure modes. Be specific — file:line references, exploit scenarios, concrete fixes. Do NOT pad with praise.\n\nFocus: ${focus}`;
  }
  return { prompt, stdinPayload: diff, title: `adversarial-review: ${focus}` };
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

function isImageFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  return IMAGE_EXTENSIONS.has(ext);
}

async function buildUiReviewPrompt(flags, positional) {
  const focus = positional.join(" ") || "general UI/UX review";
  let stdinPayload = "";
  const mediaFiles = [];

  if (flags.file) {
    if (isImageFile(flags.file)) {
      mediaFiles.push(flags.file);
    } else {
      const content = await readFileContext(flags.file);
      if (content) {
        stdinPayload = `File: ${flags.file}\n${content}`;
      }
    }
  }

  const stdinContent = await readStdinIfPiped();
  if (stdinContent) {
    stdinPayload += (stdinPayload ? "\n\n" : "") + stdinContent;
  }

  if (!stdinPayload && !mediaFiles.length) {
    const diff = await getGitDiff();
    if (diff) stdinPayload = diff;
  }

  let prompt;
  try {
    const template = await loadPromptTemplate("ui-review");
    prompt = interpolateTemplate(template, { focus });
  } catch {
    prompt = `You are an expert UI/UX reviewer. Review the content provided via stdin for usability, accessibility, clarity, and user experience.\n\nFocus: ${focus}\n\nProvide feedback on:\n1. **UX flow** — Is the user journey clear and intuitive?\n2. **Accessibility** — WCAG compliance, screen readers, keyboard nav\n3. **Copy & messaging** — Error messages, labels, help text clarity\n4. **Visual hierarchy** — Layout, spacing, affordances\n5. **Edge cases** — Empty states, loading states, error states\n\nBe specific and actionable.`;
  }
  return {
    prompt,
    stdinPayload: stdinPayload || undefined,
    title: `ui-review: ${focus}`,
    mediaFiles: mediaFiles.length ? mediaFiles : undefined,
  };
}

async function buildUiDesignPrompt(flags, positional) {
  const focus = positional.join(" ") || "";
  let stdinPayload = "";
  const mediaFiles = [];

  if (flags.file) {
    if (isImageFile(flags.file)) {
      mediaFiles.push(flags.file);
    } else {
      const content = await readFileContext(flags.file);
      if (content) {
        stdinPayload = `File: ${flags.file}\n${content}`;
      }
    }
  }

  const stdinContent = await readStdinIfPiped();
  if (stdinContent) {
    stdinPayload += (stdinPayload ? "\n\n" : "") + stdinContent;
  }

  let prompt;
  try {
    const template = await loadPromptTemplate("ui-design");
    prompt = interpolateTemplate(template, { focus: focus || "redesign the entire interface" });
  } catch {
    prompt = `You are a creative UI/UX designer. Provide opinionated, specific design suggestions.\n\nFocus: ${focus || "redesign the entire interface"}\n\nBe specific — name exact colors (hex), spacing, fonts, layouts. Every suggestion must be implementable in CSS/HTML.`;
  }

  return {
    prompt,
    stdinPayload: stdinPayload || undefined,
    title: `ui-design: ${focus || "full design"}`,
    mediaFiles: mediaFiles.length ? mediaFiles : undefined,
  };
}

async function buildTaskPrompt(flags, positional) {
  const taskPrompt = positional.join(" ");
  if (!taskPrompt) throw new Error("No task prompt provided.\nUsage: /gemini:task <prompt>");

  const stdinContent = await readStdinIfPiped();
  if (stdinContent) {
    return { prompt: taskPrompt, stdinPayload: stdinContent, title: taskPrompt };
  }
  return { prompt: taskPrompt, title: taskPrompt };
}

// ─── Generic run-or-background handler ──────────────────────────────

async function runCommand(kind, flags, positional, promptBuilder) {
  const { prompt, stdinPayload, title, empty, mediaFiles } = await promptBuilder(flags, positional);

  if (empty) {
    console.log("No changes found to review.");
    return;
  }

  const isBackground = flags.background === true;

  if (isBackground) {
    const jobId = generateJobId(kind.slice(0, 3));
    const info = launchBackgroundWorker(jobId, kind, prompt, {
      model: flags.model,
      yolo: flags.yolo,
      title,
      stdinPayload,
      mediaFiles,
    });

    const lines = [
      `# Gemini ${kind} — background`,
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/gemini:status ${info.jobId}\``,
      `- Get result: \`/gemini:result ${info.jobId}\``,
      `- Cancel: \`/gemini:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground (--wait or default)
  console.error(`[gemini] Running ${kind}...`);
  const result = await runGeminiPrompt(prompt, {
    model: flags.model,
    yolo: flags.yolo || false,
    resume: flags.resume || undefined,
    mediaFiles,
    stdin: stdinPayload,
  });

  if (result.exitCode !== 0) {
    console.error(`Gemini exited with code ${result.exitCode}`);
  }
  console.log(result.text);
}

// ─── status ─────────────────────────────────────────────────────────

async function cmdStatus(flags, positional) {
  const reference = positional[0] || null;

  if (reference) {
    const { job } = buildSingleJobSnapshot(process.cwd(), reference);
    const rendered = renderJobStatusReport(job);
    outputResult(flags.json ? job : rendered, flags.json);
    return;
  }

  const report = buildStatusSnapshot(process.cwd(), { all: flags.all });
  const rendered = renderStatusReport(report);
  outputResult(flags.json ? report : rendered, flags.json);
}

// ─── result ─────────────────────────────────────────────────────────

async function cmdResult(flags, positional) {
  const reference = positional[0] || null;
  const { workspaceRoot, job } = resolveResultJob(process.cwd(), reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);

  if (flags.json) {
    outputResult({ job: enrichJob(job), storedJob }, true);
    return;
  }

  const rendered = renderStoredJobResult(job, storedJob);
  process.stdout.write(rendered);
}

// ─── cancel ─────────────────────────────────────────────────────────

async function cmdCancel(flags, positional) {
  const reference = positional[0] || null;
  const { workspaceRoot, job } = resolveCancelableJob(process.cwd(), reference);

  // Kill the process if it has a PID
  if (job.pid) {
    try {
      await terminateProcessTree(job.pid);
    } catch {
      // Process may already be gone
    }
  }

  // Update state
  const completedAt = nowIso();
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
  });

  // Update job file
  const jobFile = resolveJobFile(workspaceRoot, job.id);
  if (fs.existsSync(jobFile)) {
    const stored = readJobFile(jobFile);
    writeJobFile(workspaceRoot, job.id, {
      ...stored,
      status: "cancelled",
      phase: "cancelled",
      pid: null,
      completedAt,
    });
  }

  appendLogLine(job.logFile, "Cancelled by user.");

  const rendered = renderCancelReport(job);
  outputResult(flags.json ? { cancelled: true, job } : rendered, flags.json);
}

// ─── task-worker (internal, spawned by background launcher) ─────────

async function cmdTaskWorker(flags, positional) {
  const jobId = positional[0] || process.env.GEMINI_WORKER_JOB_ID;
  const workspaceRoot = process.env.GEMINI_WORKER_WORKSPACE || process.cwd();

  if (!jobId) {
    process.exit(1);
  }

  // Read the job file to get the prompt
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    process.exit(1);
  }

  const jobData = readJobFile(jobFile);
  const logFile = jobData.logFile || resolveJobLogFile(workspaceRoot, jobId);
  const prompt = jobData.prompt;
  const stdinPayload = jobData.stdinPayload || null;
  const mediaFiles = jobData.mediaFiles || [];

  if (!prompt) {
    appendLogLine(logFile, "No prompt found in job file.");
    upsertJob(workspaceRoot, { id: jobId, status: "failed", phase: "failed", pid: null, completedAt: nowIso() });
    process.exit(1);
  }

  appendLogLine(logFile, `Worker started (PID ${process.pid}).`);
  appendLogLine(logFile, `Running Gemini ${flags.kind || "task"}...`);

  // Update job to running
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "running", pid: process.pid });

  try {
    const result = await runGeminiPrompt(prompt, {
      model: flags.model,
      yolo: flags.yolo || false,
      timeout: 600_000, // 10 min for background jobs
      stdin: stdinPayload,
      mediaFiles: mediaFiles.length ? mediaFiles : undefined,
    });

    const completionStatus = result.exitCode === 0 ? "completed" : "failed";
    const completedAt = nowIso();

    // Summarize: first 120 chars of response
    const summary = result.text
      ? result.text.replace(/\s+/g, " ").trim().slice(0, 120) + (result.text.length > 120 ? "..." : "")
      : null;

    writeJobFile(workspaceRoot, jobId, {
      ...jobData,
      status: completionStatus,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt,
      exitCode: result.exitCode,
      result: result.text,
      rendered: result.text,
      summary,
    });

    upsertJob(workspaceRoot, {
      id: jobId,
      status: completionStatus,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt,
      summary,
    });

    appendLogLine(logFile, `Completed with exit code ${result.exitCode}.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();

    writeJobFile(workspaceRoot, jobId, {
      ...jobData,
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt,
      errorMessage,
    });

    upsertJob(workspaceRoot, {
      id: jobId,
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt,
      errorMessage,
    });

    appendLogLine(logFile, `Failed: ${errorMessage}`);
    process.exit(1);
  }
}

// ─── main ───────────────────────────────────────────────────────────

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
      await cmdSetup(flags);
      break;
    case "ask":
      await runCommand("ask", flags, positional, buildAskPrompt);
      break;
    case "review":
      await runCommand("review", flags, positional, buildReviewPrompt);
      break;
    case "ui-review":
      await runCommand("ui-review", flags, positional, buildUiReviewPrompt);
      break;
    case "ui-design":
      await runCommand("ui-design", flags, positional, buildUiDesignPrompt);
      break;
    case "task":
      await runCommand("task", flags, positional, buildTaskPrompt);
      break;
    case "adversarial-review":
      await runCommand("adversarial-review", flags, positional, buildAdversarialReviewPrompt);
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
    case "task-worker":
      await cmdTaskWorker(flags, positional);
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
