#!/usr/bin/env node

/**
 * grok-companion.mjs — Main entry point for the Grok plugin.
 *
 * Subcommands:
 *   setup          Check xAI API key and connectivity
 *   sentiment      X sentiment scan on a topic
 *   pulse          Quick directional read from X
 *   compare        Compare reception of two topics on X
 *   ask            General Grok query with X search enabled
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
  getGrokAvailability,
  runGrokPrompt,
  buildXSearchTool,
  buildWebSearchTool,
  normalizeRequestedModel,
  loadPromptTemplate,
  interpolateTemplate,
} from "./lib/grok.mjs";
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
      "Usage:",
      "  node scripts/grok-companion.mjs setup [--json]",
      "  node scripts/grok-companion.mjs sentiment [--background] [--model <model>] [--from <date>] [--to <date>] <topic>",
      "  node scripts/grok-companion.mjs pulse [--background] [--model <model>] <topic>",
      "  node scripts/grok-companion.mjs compare [--background] [--model <model>] <topicA> vs <topicB>",
      "  node scripts/grok-companion.mjs ask [--background] [--model <model>] [--web] <question>",
      "  node scripts/grok-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/grok-companion.mjs result [job-id] [--json]",
      "  node scripts/grok-companion.mjs cancel [job-id] [--json]",
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
    tools: options.tools || null,
    systemPrompt: options.systemPrompt || null,
  });

  writeJobFile(workspaceRoot, jobId, { ...jobRecord, prompt, tools: options.tools, systemPrompt: options.systemPrompt });
  upsertJob(workspaceRoot, jobRecord);

  const workerArgs = [SCRIPT_PATH, "task-worker", jobId, "--kind", kind];
  if (options.model) workerArgs.push("--model", options.model);

  const child = spawn("node", workerArgs, {
    cwd: workspaceRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      GROK_WORKER_JOB_ID: jobId,
      GROK_WORKER_WORKSPACE: workspaceRoot,
    },
  });

  child.unref();
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "starting", pid: child.pid });

  return { jobId, logFile, pid: child.pid, workspaceRoot };
}

// ─── setup ──────────────────────────────────────────────────────────

async function cmdSetup(flags) {
  const status = await getGrokAvailability();

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    const lines = [];
    if (status.available) {
      lines.push("Grok API — ready.");
      lines.push("");
      lines.push("Available commands:");
      lines.push("  /grok:sentiment <topic>         — X sentiment scan");
      lines.push("  /grok:pulse <topic>              — Quick directional read from X");
      lines.push("  /grok:compare <A> vs <B>         — Compare two topics on X");
      lines.push("  /grok:ask <question>             — General query with X search");
      lines.push("  /grok:status [job-id]            — Show job status");
      lines.push("  /grok:result [job-id]            — Show finished job result");
      lines.push("  /grok:cancel [job-id]            — Cancel an active job");
      lines.push("");
      lines.push("All commands support --background for async execution.");
    } else {
      lines.push("Grok API is not available.");
      lines.push(`Error: ${status.error}`);
      lines.push("");
      lines.push("Set XAI_API_KEY in your environment. Get a key at https://console.x.ai");
    }
    console.log(lines.join("\n"));
  }
}

// ─── Prompt builders ────────────────────────────────────────────────

async function buildSentimentPrompt(flags, positional) {
  const topic = positional.join(" ");
  if (!topic) throw new Error("No topic provided.\nUsage: /grok:sentiment <topic>");

  const tools = [buildXSearchTool({ fromDate: flags.from, toDate: flags.to })];

  let systemPrompt;
  try {
    const template = await loadPromptTemplate("sentiment");
    systemPrompt = interpolateTemplate(template, { topic });
  } catch {
    systemPrompt = `Search X for "${topic}" and produce a sentiment analysis. Cover: overall sentiment, key themes, notable voices, objections, positive reception, and 3-5 representative posts.`;
  }

  return { prompt: `Analyse X sentiment for: ${topic}`, systemPrompt, tools, title: topic };
}

async function buildPulsePrompt(flags, positional) {
  const topic = positional.join(" ");
  if (!topic) throw new Error("No topic provided.\nUsage: /grok:pulse <topic>");

  const tools = [buildXSearchTool()];

  let systemPrompt;
  try {
    const template = await loadPromptTemplate("pulse");
    systemPrompt = interpolateTemplate(template, { topic });
  } catch {
    systemPrompt = `Quick read on what X is saying about "${topic}" right now. Direction, volume, trend, key reactions, one-line takeaway.`;
  }

  return { prompt: `Quick X pulse check: ${topic}`, systemPrompt, tools, title: topic };
}

async function buildComparePrompt(flags, positional) {
  const raw = positional.join(" ");
  const vsIndex = raw.toLowerCase().indexOf(" vs ");
  if (vsIndex === -1) {
    throw new Error("Use 'vs' to separate topics.\nUsage: /grok:compare <topic A> vs <topic B>");
  }

  const topicA = raw.slice(0, vsIndex).trim();
  const topicB = raw.slice(vsIndex + 4).trim();

  if (!topicA || !topicB) {
    throw new Error("Both topics are required.\nUsage: /grok:compare <topic A> vs <topic B>");
  }

  const tools = [buildXSearchTool()];

  let systemPrompt;
  try {
    const template = await loadPromptTemplate("compare");
    systemPrompt = interpolateTemplate(template, { topicA, topicB });
  } catch {
    systemPrompt = `Compare X reception of "${topicA}" vs "${topicB}". Search both, compare sentiment/volume/themes, pick a winner.`;
  }

  return { prompt: `Compare X reception: "${topicA}" vs "${topicB}"`, systemPrompt, tools, title: `${topicA} vs ${topicB}` };
}

async function buildAskPrompt(flags, positional) {
  const question = positional.join(" ");
  if (!question) throw new Error("No question provided.\nUsage: /grok:ask <question>");

  const tools = [buildXSearchTool()];
  if (flags.web) {
    tools.push(buildWebSearchTool());
  }

  return { prompt: question, tools, title: question };
}

// ─── Generic run-or-background handler ──────────────────────────────

async function runCommand(kind, flags, positional, promptBuilder) {
  const { prompt, systemPrompt, tools, title } = await promptBuilder(flags, positional);

  // sentiment, compare, and ask auto-background unless --wait is explicitly passed
  const autoBackground = (kind === "sentiment" || kind === "compare") && flags.wait !== true;
  const isBackground = flags.background === true || autoBackground;

  if (isBackground) {
    const jobId = generateJobId(kind.slice(0, 3));
    const info = launchBackgroundWorker(jobId, kind, prompt, {
      model: flags.model,
      title,
      tools,
      systemPrompt,
    });

    const lines = [
      `# Grok ${kind} — background`,
      "",
      `Job **${info.jobId}** is running in the background (PID ${info.pid}).`,
      "",
      "Commands:",
      `- Check progress: \`/grok:status ${info.jobId}\``,
      `- Get result: \`/grok:result ${info.jobId}\``,
      `- Cancel: \`/grok:cancel ${info.jobId}\``,
    ];
    console.log(lines.join("\n"));
    return;
  }

  // Foreground
  console.error(`[grok] Running ${kind}...`);
  const result = await runGrokPrompt(prompt, {
    model: flags.model,
    tools,
    systemPrompt,
  });

  if (result.exitCode !== 0) {
    console.error(`Grok returned an error`);
  }

  console.log(result.text);

  // Show citations if any
  if (result.citations?.length) {
    console.log("\n---\nSources:");
    for (const cite of result.citations) {
      if (cite.url) {
        console.log(`- ${cite.title || cite.url}: ${cite.url}`);
      }
    }
  }
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
  const jobId = positional[0] || process.env.GROK_WORKER_JOB_ID;
  const workspaceRoot = process.env.GROK_WORKER_WORKSPACE || process.cwd();

  if (!jobId) process.exit(1);

  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) process.exit(1);

  const jobData = readJobFile(jobFile);
  const logFile = jobData.logFile || resolveJobLogFile(workspaceRoot, jobId);
  const prompt = jobData.prompt;
  const tools = jobData.tools || null;
  const systemPrompt = jobData.systemPrompt || null;

  if (!prompt) {
    appendLogLine(logFile, "No prompt found in job file.");
    upsertJob(workspaceRoot, { id: jobId, status: "failed", phase: "failed", pid: null, completedAt: nowIso() });
    process.exit(1);
  }

  appendLogLine(logFile, `Worker started (PID ${process.pid}).`);
  appendLogLine(logFile, `Running Grok ${flags.kind || "task"}...`);
  upsertJob(workspaceRoot, { id: jobId, status: "running", phase: "running", pid: process.pid });

  try {
    const result = await runGrokPrompt(prompt, {
      model: flags.model,
      tools: tools || undefined,
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
      citations: result.citations,
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

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) { printUsage(); process.exit(0); }

  const subcommand = rawArgs[0];
  const { flags, positional } = parseArgs(rawArgs.slice(1));

  switch (subcommand) {
    case "setup":      await cmdSetup(flags); break;
    case "sentiment":  await runCommand("sentiment", flags, positional, buildSentimentPrompt); break;
    case "pulse":      await runCommand("pulse", flags, positional, buildPulsePrompt); break;
    case "compare":    await runCommand("compare", flags, positional, buildComparePrompt); break;
    case "ask":        await runCommand("ask", flags, positional, buildAskPrompt); break;
    case "status":     await cmdStatus(flags, positional); break;
    case "result":     await cmdResult(flags, positional); break;
    case "cancel":     await cmdCancel(flags, positional); break;
    case "task-worker": await cmdTaskWorker(flags, positional); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
