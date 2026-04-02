import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_ACP_PATH = path.resolve(__dirname, "..", "gemini-acp.py");

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export async function callGeminiAcp(subcommand, args = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  return new Promise((resolve) => {
    const proc = spawn("python3", [GEMINI_ACP_PATH, subcommand, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
      timeout: options.timeout || 600_000,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("close", (code) => {
      const data = tryParseJson(stdout.trim());
      resolve({
        ok: data?.ok ?? false,
        data: data || { ok: false, error: stdout.trim() || "Unknown error", error_code: "parse_error" },
        exitCode: code ?? 1,
        stderr: stderr.trim(),
      });
    });
    proc.on("error", (err) => {
      resolve({
        ok: false,
        data: { ok: false, error: err.message, error_code: "spawn_error" },
        exitCode: 1,
        stderr: err.message,
      });
    });
  });
}

export async function* streamGeminiAcp(subcommand, args = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  const proc = spawn("python3", [GEMINI_ACP_PATH, subcommand, "--stream", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    timeout: options.timeout || 600_000,
  });
  let buffer = "";
  proc.stderr.on("data", () => {}); // drain stderr

  const lines = (async function* () {
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) yield line;
      }
    }
    const rest = buffer.trim();
    if (rest) yield rest;
  })();

  for await (const line of lines) {
    const parsed = tryParseJson(line);
    if (parsed) {
      yield parsed;
      if (parsed.terminal) break;
    }
  }
}
