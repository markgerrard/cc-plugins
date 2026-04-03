/**
 * Fan-out execution — send a prompt to multiple models in parallel.
 * Returns results as they complete.
 */

import { spawn } from "node:child_process";
import { getModel, resolveCompanionPath } from "./models.mjs";

/**
 * Call a single model and return the response text.
 * Supports two types:
 *   - "companion" (default): spawn node <companion-script> <command> <prompt>
 *   - "cli": spawn <binary> <cliArgs...> <prompt>
 */
function callModel(modelKey, prompt, timeout = 300_000) {
  const def = getModel(modelKey);
  if (!def) {
    return Promise.resolve({
      model: modelKey,
      text: null,
      durationMs: 0,
      error: `Unknown model: ${modelKey}`,
    });
  }

  let cmd, args;

  if (def.type === "cli") {
    // Direct CLI binary (e.g., codex exec)
    cmd = def.binary;
    args = [...(def.cliArgs || []), prompt];
  } else {
    // Node companion script (default)
    const companionPath = resolveCompanionPath(modelKey);
    if (!companionPath) {
      return Promise.resolve({
        model: def.name,
        text: null,
        durationMs: 0,
        error: `Plugin not installed for ${def.name}`,
      });
    }
    cmd = "node";
    args = [companionPath, def.command, prompt];
  }

  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("close", (code) => {
      const durationMs = Date.now() - start;
      const text = stdout.trim();

      if (code !== 0 && !text) {
        resolve({
          model: def.name,
          text: null,
          durationMs,
          error: stderr.trim() || `Exit code ${code}`,
        });
      } else {
        resolve({
          model: def.name,
          text: text || "(no response)",
          durationMs,
          error: null,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        model: def.name,
        text: null,
        durationMs: Date.now() - start,
        error: err.message,
      });
    });
  });
}

/**
 * Fan out a prompt to multiple models in parallel.
 * @param {string[]} modelKeys - Array of model keys
 * @param {string} prompt - The prompt to send
 * @param {number} timeout - Per-model timeout in ms
 * @returns {Promise<Array<{model, text, durationMs, error}>>}
 */
export async function fanOut(modelKeys, prompt, timeout = 300_000) {
  const promises = modelKeys.map((key) => callModel(key, prompt, timeout));
  return Promise.all(promises);
}
