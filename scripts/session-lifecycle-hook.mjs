#!/usr/bin/env node

/**
 * Session lifecycle hook — handles SessionStart and SessionEnd events.
 *
 * SessionStart: sets GEMINI_COMPANION_SESSION_ID env var
 * SessionEnd: cleans up stale running jobs (marks as failed if PID is dead)
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import process from "node:process";

import { listJobs, upsertJob, writeJobFile, readJobFile, resolveJobFile } from "./lib/state.mjs";
import { nowIso, SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const event = process.argv[2]; // "SessionStart" or "SessionEnd"

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function handleSessionStart() {
  // Generate and output the session ID for the harness to capture
  const sessionId = randomUUID();
  // Output as JSON so the harness can parse env vars to set
  console.log(JSON.stringify({
    env: {
      [SESSION_ID_ENV]: sessionId,
    },
  }));
}

function handleSessionEnd() {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const jobs = listJobs(workspaceRoot);
  const completedAt = nowIso();

  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "running") continue;

    // Check if the process is still alive
    if (job.pid && isProcessAlive(job.pid)) {
      // Try to terminate it gracefully
      try {
        process.kill(job.pid, "SIGTERM");
      } catch {
        // Already dead
      }
    }

    // Mark as failed
    upsertJob(workspaceRoot, {
      id: job.id,
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt,
      errorMessage: "Session ended while job was still running.",
    });

    const jobFile = resolveJobFile(workspaceRoot, job.id);
    if (fs.existsSync(jobFile)) {
      try {
        const stored = readJobFile(jobFile);
        writeJobFile(workspaceRoot, job.id, {
          ...stored,
          status: "failed",
          phase: "failed",
          pid: null,
          completedAt,
          errorMessage: "Session ended while job was still running.",
        });
      } catch {
        // Ignore corrupt job files
      }
    }
  }
}

switch (event) {
  case "SessionStart":
    handleSessionStart();
    break;
  case "SessionEnd":
    handleSessionEnd();
    break;
  default:
    // Unknown event, ignore
    break;
}
