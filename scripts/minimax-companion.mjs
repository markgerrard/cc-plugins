#!/usr/bin/env node

/**
 * minimax-companion.mjs — Main entry point for the MiniMax plugin.
 *
 * Subcommands:
 *   setup          Check MiniMax API key and connectivity
 *   ask            General MiniMax query
 *   task           Structured task delegation
 *   review         Code review using git diff (piped via stdin)
 *   status         Show active and recent jobs
 *   result         Show finished job output
 *   cancel         Cancel an active background job
 *   task-worker    Internal: run a background job
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import {
  getMiniMaxAvailability,
  runMiniMaxPrompt,
  normalizeRequestedModel,
  loadPromptTemplate,
  interpolateTemplate,
} from "./lib/minimax.mjs";
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
  nowIso,
  SESSION_ID_ENV,
} from "./lib/tracked-jobs.mjs";
import {
  buildStatusSnapshot,
  buildSingleJobSnapshot,
  enrichJob,
  resolveResultJob,
  resolveCancelableJob,
  readStoredJob,
} from "./lib/job-control.mjs";
import {
  renderStatusReport,
  renderJobStatusReport,
  renderStoredJobResult,
  renderCancelReport,
} from "./lib/render.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import { createPiClient } from "./lib/pi-rpc.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/minimax-companion.mjs setup [--json]",
      "  node scripts/minimax-companion.mjs ask [--background] [--model <model>] <question>",
      "  node scripts/minimax-companion.mjs task [--background] [--model <model>] <prompt>",
      "  node scripts/minimax-companion.mjs review [--background] [--model <model>] [--focus <area>]",
      "  node scripts/minimax-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/minimax-companion.mjs result [job-id] [--json]",
      "  node scripts/minimax-companion.mjs cancel [job-id] [--json]",
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

/**
 * Read all of stdin (for piped git diff).
 */
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  return text || null;
}

// ─── Background job launcher ────────────────────────────────────────

function launchBackgroundWorker(jobId, kind, prompt, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const logFile = createJobLogFile(workspaceRoot, jobId, `${kind} job`);

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
    systemPrompt: options.systemPrompt || null,
  });

  writeJobFile(workspaceRoot, jobId, { ...jobRecord, prompt, systemPrompt: options.systemPrompt });
  upsertJob(workspaceRoot, jobRecord);

  const workerArgs = [SCRIPT_PATH, "task-worker", jobId, "--kind", kind];
  if (options.model) workerArgs.push("--model", options.model);

  const child = spawn("node", workerArgs, {
    cwd: workspaceRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      MINIMAX_WORKER_JOB_ID: jobId,
      MINIMAX_WORKER_WORKSPACE: workspaceRoot,
    },
  });

  child.unref();
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "starting", pid: child.pid });

  return { jobId, logFile, pid: child.pid, workspaceRoot };
}

// ─── setup ──────────────────────────────────────────────────────────

async function cmdSetup(flags) {
  const status = await getMiniMaxAvailability();

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    const lines = [];
    if (status.available) {
      lines.push("MiniMax API — ready.");
      lines.push("");
      lines.push("Available commands:");
      lines.push("  /minimax:ask <question>           — General query");
      lines.push("  /minimax:task <prompt>             — Structured task delegation");
      lines.push("  /minimax:review [--focus <area>]   — Code review via git diff");
      lines.push("  /minimax:status [job-id]           — Show job status");
      lines.push("  /minimax:result [job-id]           — Show finished job result");
      lines.push("  /minimax:cancel [job-id]           — Cancel an active job");
      lines.push("");
      lines.push("All commands support --background for async execution.");
    } else {
      lines.push("MiniMax API is not available.");
      lines.push(`Error: ${status.error}`);
      lines.push("");
      lines.push("Set MINIMAX_API_KEY in your environment. Get a key at https://platform.minimax.io");
    }
    console.log(lines.join("\n"));
  }
}

// ─── Prompt builders ────────────────────────────────────────────────

async function buildAskPrompt(flags, positional) {
  const question = positional.join(" ");
  if (!question) throw new Error("No question provided.\nUsage: /minimax:ask <question>");

  return { prompt: question, title: question };
}

async function buildTaskPrompt(flags, positional) {
  const taskDescription = positional.join(" ");
  if (!taskDescription) throw new Error("No task provided.\nUsage: /minimax:task <prompt>");

  const systemPrompt = [
    "You are a structured task executor. Follow the user's instructions precisely.",
    "Produce clear, well-organized output.",
    "If the task involves code, provide complete, working code with explanations.",
    "If the task involves analysis, be thorough and cite specific evidence.",
    "If the task involves writing, be concise and direct.",
  ].join("\n");

  return { prompt: taskDescription, systemPrompt, title: taskDescription };
}

async function buildReviewPrompt(flags, positional) {
  const stdinContent = await readStdin();
  if (!stdinContent) {
    throw new Error(
      "No diff provided on stdin.\nUsage: git diff | node minimax-companion.mjs review [--focus <area>]"
    );
  }

  const focus = flags.focus || positional.join(" ") || null;

  let systemPrompt;
  try {
    const template = await loadPromptTemplate("code-review");
    systemPrompt = interpolateTemplate(template, { focus: focus || "general correctness, edge cases, and side effects" });
  } catch {
    systemPrompt = [
      "You are an expert code reviewer. Review the following diff carefully.",
      focus ? `Focus on: ${focus}` : "Focus on: correctness, edge cases, side effects, security, and performance.",
      "",
      "Structure your review as:",
      "1. **Summary** — What the change does (1-2 sentences)",
      "2. **Issues** — Bugs, risks, or concerns (with file/line references)",
      "3. **Suggestions** — Improvements (with code examples where helpful)",
      "4. **Verdict** — Ship it / Needs changes / Needs discussion",
    ].join("\n");
  }

  const prompt = `Review this diff:\n\n\`\`\`diff\n${stdinContent}\n\`\`\``;

  return { prompt, systemPrompt, title: focus ? `review: ${focus}` : "code review" };
}

// ─── Generic run-or-background handler ──────────────────────────────

async function runCommand(kind, flags, positional, promptBuilder) {
  const { prompt, systemPrompt, title } = await promptBuilder(flags, positional);

  // task and review auto-background unless --wait is explicitly passed
  const autoBackground = (kind === "task" || kind === "review") && flags.wait !== true;
  const isBackground = flags.background === true || autoBackground;

  if (isBackground) {
    const jobId = generateJobId(kind.slice(0, 3));
    const info = launchBackgroundWorker(jobId, kind, prompt, {
      model: flags.model,
      title,
      systemPrompt,
    });

    const lines = [
      `# MiniMax ${kind} — background`,
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/minimax:status ${info.jobId}\``,
      `- Get result: \`/minimax:result ${info.jobId}\``,
      `- Cancel: \`/minimax:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error(`[minimax] Running ${kind}...`);
  const result = await runMiniMaxPrompt(prompt, {
    model: flags.model,
    systemPrompt,
  });

  if (result.exitCode !== 0) {
    console.error(`MiniMax returned an error`);
  }

  console.log(result.text);
}

// ─── status ─────────────────────────────────────────────────────────

async function cmdStatus(flags, positional) {
  const reference = positional[0] || null;

  if (reference) {
    const { job } = buildSingleJobSnapshot(process.cwd(), reference);
    outputResult(flags.json ? job : renderJobStatusReport(job), flags.json);
    return;
  }

  const report = buildStatusSnapshot(process.cwd(), { all: flags.all });
  outputResult(flags.json ? report : renderStatusReport(report), flags.json);
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

  process.stdout.write(renderStoredJobResult(job, storedJob));
}

// ─── cancel ─────────────────────────────────────────────────────────

async function cmdCancel(flags, positional) {
  const reference = positional[0] || null;
  const { workspaceRoot, job } = resolveCancelableJob(process.cwd(), reference);

  if (job.pid) {
    try { await terminateProcessTree(job.pid); } catch {}
  }

  const completedAt = nowIso();
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled", pid: null, completedAt });

  const jobFile = resolveJobFile(workspaceRoot, job.id);
  if (fs.existsSync(jobFile)) {
    const stored = readJobFile(jobFile);
    writeJobFile(workspaceRoot, job.id, { ...stored, status: "cancelled", phase: "cancelled", pid: null, completedAt });
  }

  appendLogLine(job.logFile, "Cancelled by user.");
  outputResult(flags.json ? { cancelled: true, job } : renderCancelReport(job), flags.json);
}

// ─── task-worker ────────────────────────────────────────────────────

async function cmdTaskWorker(flags, positional) {
  const jobId = positional[0] || process.env.MINIMAX_WORKER_JOB_ID;
  const workspaceRoot = process.env.MINIMAX_WORKER_WORKSPACE || process.cwd();

  if (!jobId) process.exit(1);

  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) process.exit(1);

  const jobData = readJobFile(jobFile);
  const logFile = jobData.logFile || resolveJobLogFile(workspaceRoot, jobId);
  const prompt = jobData.prompt;
  const systemPrompt = jobData.systemPrompt || null;

  if (!prompt) {
    appendLogLine(logFile, "No prompt found in job file.");
    upsertJob(workspaceRoot, { id: jobId, status: "failed", phase: "failed", pid: null, completedAt: nowIso() });
    process.exit(1);
  }

  appendLogLine(logFile, `Worker started (PID ${process.pid}).`);
  appendLogLine(logFile, `Running MiniMax ${flags.kind || "task"}...`);
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "running", pid: process.pid });

  try {
    const result = await runMiniMaxPrompt(prompt, {
      model: flags.model,
      systemPrompt: systemPrompt || undefined,
      timeout: 300_000,
    });

    const completionStatus = result.exitCode === 0 ? "completed" : "failed";
    const completedAt = nowIso();

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

    appendLogLine(logFile, `Completed.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();

    writeJobFile(workspaceRoot, jobId, { ...jobData, status: "failed", phase: "failed", pid: null, completedAt, errorMessage });
    upsertJob(workspaceRoot, { id: jobId, status: "failed", phase: "failed", pid: null, completedAt, errorMessage });
    appendLogLine(logFile, `Failed: ${errorMessage}`);
    process.exit(1);
  }
}

// ─── code (Pi RPC) ──────────────────────────────────────────────────

async function cmdCode(flags, positional) {
  const task = positional.join(" ");
  if (!task) {
    console.error("Error: No task provided.\nUsage: /minimax:code <task>");
    process.exit(1);
  }

  const model = normalizeRequestedModel(flags.model);
  console.error(`[minimax:code] Starting Pi with MiniMax (${model})...`);

  const workDir = resolveWorkspaceRoot(process.cwd());
  console.error(`[minimax:code] Working directory: ${workDir}`);

  const pi = createPiClient({
    provider: "minimax",
    model: model,
    cwd: workDir,
  });

  try {
    await pi.start();
    console.error("[minimax:code] Pi started. Sending task...");

    const events = await pi.promptAndWait(task, 300_000);

    let finalText;
    try {
      finalText = await pi.getLastAssistantText();
    } catch {
      const textParts = [];
      for (const event of events) {
        if (event.type === "text_delta") textParts.push(event.text || event.delta || "");
        if (event.type === "tool_start") console.error(`[minimax:code] Tool: ${event.tool}`);
      }
      finalText = textParts.join("") || "(No output captured)";
    }

    // Strip think tags from reasoning models
    finalText = finalText.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    console.log(finalText);
  } catch (err) {
    console.error(`[minimax:code] Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pi.stop();
  }
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) { printUsage(); process.exit(0); }

  const subcommand = rawArgs[0];
  const { flags, positional } = parseArgs(rawArgs.slice(1));

  switch (subcommand) {
    case "setup":       await cmdSetup(flags); break;
    case "ask":         await runCommand("ask", flags, positional, buildAskPrompt); break;
    case "task":        await runCommand("task", flags, positional, buildTaskPrompt); break;
    case "review":      await runCommand("review", flags, positional, buildReviewPrompt); break;
    case "status":      await cmdStatus(flags, positional); break;
    case "result":      await cmdResult(flags, positional); break;
    case "cancel":      await cmdCancel(flags, positional); break;
    case "code":        await cmdCode(flags, positional); break;
    case "task-worker": await cmdTaskWorker(flags, positional); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
