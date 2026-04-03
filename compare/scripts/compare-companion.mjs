#!/usr/bin/env node

/**
 * compare-companion.mjs — Multi-model compare/consensus plugin.
 *
 * Subcommands:
 *   compare    Fan out to multiple models, show responses side-by-side
 *   consensus  Fan out, then synthesise agreement/disagreement summary
 *   models     List available models
 */

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fanOut } from "./lib/fanout.mjs";
import { parseModelList, listModels, getModel, DEFAULT_MODELS } from "./lib/models.mjs";

// ─── Arg parsing ────────────────────────────────────────────────────

const BOOLEAN_FLAGS = new Set(["full", "background", "stream"]);

function parseArgs(rawArgs) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < rawArgs.length) {
    if (rawArgs[i].startsWith("--")) {
      const key = rawArgs[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        i++;
      } else if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith("--")) {
        flags[key] = rawArgs[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(rawArgs[i]);
      i++;
    }
  }
  return { flags, positional };
}

// ─── Render ─────────────────────────────────────────────────────────

function renderCompare(results, prompt) {
  const lines = [
    `## Multi-Model Compare`,
    "",
    `**Prompt:** ${prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt}`,
    `**Models:** ${results.map((r) => r.model).join(", ")}`,
    "",
  ];

  for (const r of results) {
    const duration = (r.durationMs / 1000).toFixed(1);
    lines.push(`### ${r.model} (${duration}s)`);
    lines.push("");
    if (r.error) {
      lines.push(`*Error: ${r.error}*`);
    } else {
      lines.push(r.text);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function renderConsensus(results, prompt) {
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  const lines = [
    `## Multi-Model Consensus`,
    "",
    `**Prompt:** ${prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt}`,
    `**Models queried:** ${results.map((r) => r.model).join(", ")}`,
    `**Responses received:** ${successful.length}/${results.length}`,
    "",
  ];

  if (failed.length) {
    lines.push(`*Failed: ${failed.map((r) => `${r.model} (${r.error})`).join(", ")}*`);
    lines.push("");
  }

  // Individual responses (collapsed)
  lines.push("### Individual Responses");
  lines.push("");

  for (const r of successful) {
    const duration = (r.durationMs / 1000).toFixed(1);
    lines.push(`**${r.model}** (${duration}s):`);
    lines.push(r.text);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("### Synthesis");
  lines.push("");
  lines.push("*Compare the responses above. Look for:*");
  lines.push("- **Agreement** — points all models converge on (high confidence)");
  lines.push("- **Divergence** — where models disagree (needs investigation)");
  lines.push("- **Unique insights** — points only one model raised (worth considering)");
  lines.push("");

  return lines.join("\n");
}

/**
 * Save results to a markdown file in the current directory.
 * Returns the file path.
 */
function saveResults(content, prefix = "compare") {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${prefix}-${ts}.md`;
  const filePath = path.join(process.cwd(), filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function renderModels() {
  const keys = listModels();
  const lines = [
    "Available models for compare/consensus:",
    "",
    `Default set: ${DEFAULT_MODELS.join(", ")}`,
    "",
  ];

  for (const key of keys) {
    const def = getModel(key);
    lines.push(`- **${key}** → ${def.name} (/${def.plugin}:${def.command})`);
  }

  lines.push("");
  lines.push("Override with: --models gemini,grok,glm");

  return lines.join("\n");
}

// ─── Commands ───────────────────────────────────────────────────────

async function cmdCompare(flags, positional) {
  const prompt = positional.join(" ");
  if (!prompt) {
    console.error("Error: prompt required\nUsage: /compare <prompt> [--models gemini,grok,glm]");
    process.exit(1);
  }

  const full = flags.full === true;
  const models = parseModelList(flags.models);
  console.error(`[compare] Querying ${models.length} models in parallel: ${models.join(", ")}${full ? " (full file access)" : ""}...`);

  const results = await fanOut(models, prompt, 300_000, { full });
  const output = renderCompare(results, prompt);
  const saved = saveResults(output, "compare");
  console.log(output);
  console.error(`[compare] Results saved to ${saved}`);
}

async function cmdConsensus(flags, positional) {
  const prompt = positional.join(" ");
  if (!prompt) {
    console.error("Error: prompt required\nUsage: /consensus <prompt> [--models gemini,grok,glm]");
    process.exit(1);
  }

  const full = flags.full === true;
  const models = parseModelList(flags.models);
  console.error(`[consensus] Querying ${models.length} models in parallel: ${models.join(", ")}${full ? " (full file access)" : ""}...`);

  const results = await fanOut(models, prompt, 300_000, { full });
  const output = renderConsensus(results, prompt);
  const saved = saveResults(output, "consensus");
  console.log(output);
  console.error(`[consensus] Results saved to ${saved}`);
}

async function cmdReview(flags, positional) {
  const focus = positional.join(" ") || "general code review";
  const base = flags.base || "HEAD";
  const scope = flags.scope || "auto";
  const full = flags.full === true;
  const models = parseModelList(flags.models);

  let prompt;
  let mode;

  if (full) {
    // Full repo mode — let each CLI traverse the repo itself
    prompt =
      `You are an expert code reviewer. Review this repository.\n\n` +
      `IMPORTANT: You MUST read the actual source files before writing your review. ` +
      `Start by listing the directory structure, then read the key files. ` +
      `Do NOT generate a review from assumptions — only reference files you have actually read.\n\n` +
      `Focus: ${focus}\n\n` +
      `Provide:\n` +
      `1. **Architecture** — overall structure, patterns, anti-patterns\n` +
      `2. **Critical issues** — bugs, security problems, data loss risks\n` +
      `3. **Important suggestions** — performance, maintainability, best practices\n` +
      `4. **Technical debt** — areas that need refactoring or attention\n` +
      `5. **Strengths** — what's done well\n\n` +
      `Be specific: reference actual file names and line numbers from the files you read.`;
    mode = "full repo";
    console.error(`[review] Full repo review via ${models.length} models: ${models.join(", ")}...`);
  } else {
    // Diff mode — pipe the git diff into the prompt
    const diffArgs = ["diff"];
    if (scope === "branch") {
      diffArgs.push(`${base}...HEAD`);
    } else if (scope === "working-tree") {
      // unstaged only
    } else {
      diffArgs.push(base);
    }

    const diffResult = spawnSync("git", diffArgs, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });

    const diff = diffResult.stdout?.trim();
    if (!diff) {
      console.log("No changes found to review. Use --full for a full repo review.");
      process.exit(0);
    }

    prompt =
      `You are an expert code reviewer. Review the following git diff.\n\n` +
      `Focus: ${focus}\n\n` +
      `Provide:\n` +
      `1. **Critical issues** — bugs, security problems, data loss risks\n` +
      `2. **Important suggestions** — performance, maintainability, best practices\n` +
      `3. **Minor notes** — style, naming, documentation\n\n` +
      `Be specific: reference file names and line numbers.\n\n` +
      `--- GIT DIFF ---\n${diff}`;
    mode = `diff (${diffResult.stdout.trim().split("\n").length} lines)`;
    console.error(`[review] Sending ${mode} to ${models.length} models: ${models.join(", ")}...`);
  }

  const timeout = full ? 600_000 : 300_000; // 10 min for full, 5 min for diff
  const results = await fanOut(models, prompt, timeout, { full, review: true });
  const output = renderReview(results, focus, mode);
  const saved = saveResults(output, "review");
  console.log(output);
  console.error(`[review] Results saved to ${saved}`);
}

function renderReview(results, focus, mode) {
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  const lines = [
    `## Multi-Model Code Review`,
    "",
    `**Focus:** ${focus}`,
    `**Scope:** ${mode}`,
    `**Models:** ${results.map((r) => r.model).join(", ")}`,
    `**Responses:** ${successful.length}/${results.length}`,
    "",
  ];

  if (failed.length) {
    lines.push(`*Failed: ${failed.map((r) => `${r.model} (${r.error})`).join(", ")}*`);
    lines.push("");
  }

  // Individual reviews
  for (const r of successful) {
    const duration = (r.durationMs / 1000).toFixed(1);
    lines.push(`### ${r.model} (${duration}s)`);
    lines.push("");
    lines.push(r.text);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Consensus synthesis
  lines.push("### Consensus Synthesis");
  lines.push("");
  lines.push("*Review the individual assessments above. Key questions:*");
  lines.push("- **Critical issues** — which issues did multiple reviewers flag? (high confidence)");
  lines.push("- **Contradictions** — where do reviewers disagree? (investigate)");
  lines.push("- **Unique finds** — important issues only one reviewer caught (worth checking)");
  lines.push("- **Overall verdict** — is this diff safe to merge?");
  lines.push("");

  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.log(
      "Usage:\n" +
      "  compare-companion.mjs compare <prompt> [--models m1,m2,...]\n" +
      "  compare-companion.mjs consensus <prompt> [--models m1,m2,...]\n" +
      "  compare-companion.mjs models"
    );
    process.exit(0);
  }

  const subcommand = rawArgs[0];
  const { flags, positional } = parseArgs(rawArgs.slice(1));

  switch (subcommand) {
    case "compare":   await cmdCompare(flags, positional); break;
    case "consensus": await cmdConsensus(flags, positional); break;
    case "review":    await cmdReview(flags, positional); break;
    case "models":    console.log(renderModels()); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
