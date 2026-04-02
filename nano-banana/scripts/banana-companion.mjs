#!/usr/bin/env node

/**
 * banana-companion.mjs — Main entry point for the Nano Banana plugin.
 *
 * Subcommands:
 *   setup          Check Google API key and connectivity
 *   generate       Generate an image from a text prompt
 *   edit           Edit/modify an existing image
 *   variations     Generate variations of an existing image
 *   ask            General Gemini text query
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
  getBananaAvailability,
  generateImage,
  editImage,
  generateVariations,
  askGemini,
  normalizeModel,
  loadPromptTemplate,
  interpolateTemplate,
} from "./lib/banana.mjs";
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

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function printUsage() {
  console.log(
    [
      "Nano Banana — Gemini image generation for Claude Code",
      "",
      "Usage:",
      "  node scripts/banana-companion.mjs setup [--json]",
      "  node scripts/banana-companion.mjs generate [--background] [--model <model>] [--aspect <ratio>] [--size <size>] <prompt>",
      "  node scripts/banana-companion.mjs edit [--background] [--model <model>] --file <image> <prompt>",
      "  node scripts/banana-companion.mjs variations [--background] [--model <model>] --file <image>",
      "  node scripts/banana-companion.mjs ask [--background] [--model <model>] <question>",
      "  node scripts/banana-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/banana-companion.mjs result [job-id] [--json]",
      "  node scripts/banana-companion.mjs cancel [job-id] [--json]",
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

// --- Background job launcher ------------------------------------------------

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
    file: options.file || null,
    aspect: options.aspect || null,
    size: options.size || null,
  });

  writeJobFile(workspaceRoot, jobId, {
    ...jobRecord,
    prompt,
    file: options.file || null,
    aspect: options.aspect || null,
    size: options.size || null,
  });
  upsertJob(workspaceRoot, jobRecord);

  const workerArgs = [SCRIPT_PATH, "task-worker", jobId, "--kind", kind];
  if (options.model) workerArgs.push("--model", options.model);

  const child = spawn("node", workerArgs, {
    cwd: workspaceRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      BANANA_WORKER_JOB_ID: jobId,
      BANANA_WORKER_WORKSPACE: workspaceRoot,
    },
  });

  child.unref();
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "starting", pid: child.pid });

  return { jobId, logFile, pid: child.pid, workspaceRoot };
}

// --- setup ------------------------------------------------------------------

async function cmdSetup(flags) {
  const status = await getBananaAvailability();

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    const lines = [];
    if (status.available) {
      lines.push("Nano Banana -- ready.");
      lines.push("");
      lines.push("Available commands:");
      lines.push("  /banana:generate <prompt>                — Generate an image from text");
      lines.push("  /banana:edit --file <image> <prompt>     — Edit an existing image");
      lines.push("  /banana:variations --file <image>        — Generate image variations");
      lines.push("  /banana:ask <question>                   — General Gemini text query");
      lines.push("  /banana:status [job-id]                  — Show job status");
      lines.push("  /banana:result [job-id]                  — Show finished job result");
      lines.push("  /banana:cancel [job-id]                  — Cancel an active job");
      lines.push("");
      lines.push("Options:");
      lines.push("  --model <alias|id>   Model: pro, flash (default: flash)");
      lines.push("  --aspect <ratio>     Aspect ratio: 1:1, 16:9, 4:3, 3:2, 2:3, 9:16");
      lines.push("  --size <size>        Resolution: 512, 1K, 2K, 4K");
      lines.push("  --background         Run in background");
      lines.push("");
      lines.push("All image commands support --background for async execution.");
    } else {
      lines.push("Nano Banana is not available.");
      lines.push(`Error: ${status.error}`);
      lines.push("");
      lines.push("Set GOOGLE_API_KEY in your environment.");
      lines.push("Get a key at https://aistudio.google.com/apikey");
    }
    console.log(lines.join("\n"));
  }
}

// --- generate ---------------------------------------------------------------

async function cmdGenerate(flags, positional) {
  const prompt = positional.join(" ");
  if (!prompt) {
    throw new Error("No prompt provided.\nUsage: /banana:generate <prompt>");
  }

  const isBackground = flags.background === true;

  if (isBackground) {
    const jobId = generateJobId("ban");
    const info = launchBackgroundWorker(jobId, "generate", prompt, {
      model: flags.model,
      title: prompt,
      aspect: flags.aspect,
      size: flags.size,
    });

    const lines = [
      "# Banana generate -- background",
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/banana:status ${info.jobId}\``,
      `- Get result: \`/banana:result ${info.jobId}\``,
      `- Cancel: \`/banana:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error("[banana] Generating image...");
  const result = await generateImage(prompt, {
    model: flags.model,
    aspect: flags.aspect,
    size: flags.size,
  });

  if (result.exitCode !== 0) {
    console.error("Banana returned an error");
  }

  console.log(result.text);
  if (result.imagePath) {
    console.log(`\nImage file: ${result.imagePath}`);
  }
}

// --- edit -------------------------------------------------------------------

async function cmdEdit(flags, positional) {
  const prompt = positional.join(" ");
  if (!prompt) {
    throw new Error("No edit prompt provided.\nUsage: /banana:edit --file <image> <prompt>");
  }
  if (!flags.file) {
    throw new Error("No image file specified.\nUsage: /banana:edit --file <image> <prompt>");
  }

  const isBackground = flags.background === true;

  if (isBackground) {
    const jobId = generateJobId("ban");
    const info = launchBackgroundWorker(jobId, "edit", prompt, {
      model: flags.model,
      title: prompt,
      file: flags.file,
    });

    const lines = [
      "# Banana edit -- background",
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/banana:status ${info.jobId}\``,
      `- Get result: \`/banana:result ${info.jobId}\``,
      `- Cancel: \`/banana:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error(`[banana] Editing image: ${flags.file}`);
  const result = await editImage(flags.file, prompt, {
    model: flags.model,
  });

  if (result.exitCode !== 0) {
    console.error("Banana returned an error");
  }

  console.log(result.text);
  if (result.imagePath) {
    console.log(`\nEdited image: ${result.imagePath}`);
  }
}

// --- variations -------------------------------------------------------------

async function cmdVariations(flags, positional) {
  if (!flags.file) {
    throw new Error("No image file specified.\nUsage: /banana:variations --file <image>");
  }

  const isBackground = flags.background === true;

  if (isBackground) {
    const jobId = generateJobId("ban");
    const info = launchBackgroundWorker(jobId, "variations", "Generate variations", {
      model: flags.model,
      title: `variations of ${path.basename(flags.file)}`,
      file: flags.file,
    });

    const lines = [
      "# Banana variations -- background",
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/banana:status ${info.jobId}\``,
      `- Get result: \`/banana:result ${info.jobId}\``,
      `- Cancel: \`/banana:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error(`[banana] Generating variations of: ${flags.file}`);
  const result = await generateVariations(flags.file, {
    model: flags.model,
  });

  if (result.exitCode !== 0) {
    console.error("Banana returned an error");
  }

  console.log(result.text);
  if (result.imagePath) {
    console.log(`\nVariation image: ${result.imagePath}`);
  }
}

// --- ask --------------------------------------------------------------------

async function cmdAsk(flags, positional) {
  const question = positional.join(" ");
  if (!question) {
    throw new Error("No question provided.\nUsage: /banana:ask <question>");
  }

  const isBackground = flags.background === true;

  if (isBackground) {
    const jobId = generateJobId("ban");
    const info = launchBackgroundWorker(jobId, "ask", question, {
      model: flags.model,
      title: question,
    });

    const lines = [
      "# Banana ask -- background",
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/banana:status ${info.jobId}\``,
      `- Get result: \`/banana:result ${info.jobId}\``,
      `- Cancel: \`/banana:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error("[banana] Asking Gemini...");
  const result = await askGemini(question, {
    model: flags.model,
  });

  if (result.exitCode !== 0) {
    console.error("Gemini returned an error");
  }

  console.log(result.text);
}

// --- status -----------------------------------------------------------------

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

// --- result -----------------------------------------------------------------

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

// --- cancel -----------------------------------------------------------------

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

// --- task-worker ------------------------------------------------------------

async function cmdTaskWorker(flags, positional) {
  const jobId = positional[0] || process.env.BANANA_WORKER_JOB_ID;
  const workspaceRoot = process.env.BANANA_WORKER_WORKSPACE || process.cwd();

  if (!jobId) process.exit(1);

  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) process.exit(1);

  const jobData = readJobFile(jobFile);
  const logFile = jobData.logFile || resolveJobLogFile(workspaceRoot, jobId);
  const prompt = jobData.prompt;
  const kind = flags.kind || jobData.kind || "generate";

  if (!prompt) {
    appendLogLine(logFile, "No prompt found in job file.");
    upsertJob(workspaceRoot, { id: jobId, status: "failed", phase: "failed", pid: null, completedAt: nowIso() });
    process.exit(1);
  }

  appendLogLine(logFile, `Worker started (PID ${process.pid}).`);
  appendLogLine(logFile, `Running Banana ${kind}...`);
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "running", pid: process.pid });

  try {
    let result;
    const commonOpts = { model: flags.model, timeout: 300_000, outputDir: workspaceRoot };

    switch (kind) {
      case "generate":
        result = await generateImage(prompt, {
          ...commonOpts,
          aspect: jobData.aspect,
          size: jobData.size,
        });
        break;
      case "edit":
        if (!jobData.file) throw new Error("No image file specified for edit job.");
        result = await editImage(jobData.file, prompt, commonOpts);
        break;
      case "variations":
        if (!jobData.file) throw new Error("No image file specified for variations job.");
        result = await generateVariations(jobData.file, commonOpts);
        break;
      case "ask":
        result = await askGemini(prompt, commonOpts);
        break;
      default:
        throw new Error(`Unknown job kind: ${kind}`);
    }

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
      imagePath: result.imagePath || null,
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

// --- main -------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) { printUsage(); process.exit(0); }

  const subcommand = rawArgs[0];
  const { flags, positional } = parseArgs(rawArgs.slice(1));

  switch (subcommand) {
    case "setup":       await cmdSetup(flags); break;
    case "generate":    await cmdGenerate(flags, positional); break;
    case "edit":        await cmdEdit(flags, positional); break;
    case "variations":  await cmdVariations(flags, positional); break;
    case "ask":         await cmdAsk(flags, positional); break;
    case "status":      await cmdStatus(flags, positional); break;
    case "result":      await cmdResult(flags, positional); break;
    case "cancel":      await cmdCancel(flags, positional); break;
    case "task-worker": await cmdTaskWorker(flags, positional); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
