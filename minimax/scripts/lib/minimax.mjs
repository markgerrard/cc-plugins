/**
 * Core module: MiniMax AI API client.
 * Wraps the /v1/chat/completions endpoint (OpenAI-compatible).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.minimax.io/v1";
const DEFAULT_TIMEOUT_MS = 300_000; // 2 minutes
const DEFAULT_MODEL = "MiniMax-M2.7-highspeed";

const MODEL_ALIASES = new Map([
  ["fast", "MiniMax-M2-highspeed"],
  ["m2", "MiniMax-M2-highspeed"],
  ["m2.5", "MiniMax-M2.5-highspeed"],
  ["m2.7", "MiniMax-M2.7-highspeed"],
  ["pro", "MiniMax-M2.7-highspeed"],
]);

/**
 * Resolve model aliases to full model IDs.
 */
export function normalizeRequestedModel(model) {
  if (!model) return DEFAULT_MODEL;
  return MODEL_ALIASES.get(model.toLowerCase()) ?? model;
}

/**
 * Get the API key from environment.
 */
function getApiKey() {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    throw new Error("MINIMAX_API_KEY environment variable is not set. Get your key at https://platform.minimax.io");
  }
  return key;
}

/**
 * Check if the MiniMax API is reachable and the key is valid.
 */
export async function getMiniMaxAvailability() {
  try {
    const key = getApiKey();

    // Try a minimal completion as health check
    const testResponse = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-M2",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (testResponse.ok || testResponse.status === 200) {
      return { available: true, error: null };
    }

    const errorBody = await testResponse.text().catch(() => "");
    return { available: false, error: `API returned ${testResponse.status}: ${errorBody.slice(0, 200)}` };
  } catch (err) {
    if (err.message.includes("MINIMAX_API_KEY")) {
      return { available: false, error: err.message };
    }
    return { available: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Send a request to the MiniMax Chat Completions API.
 *
 * @param {string} prompt - The user prompt
 * @param {object} options
 * @param {string} [options.model] - Model override (or alias)
 * @param {number} [options.timeout] - Timeout in ms
 * @param {string} [options.systemPrompt] - System prompt
 * @param {number} [options.maxTokens] - Max completion tokens
 * @param {number} [options.temperature] - Temperature (0.0, 1.0]
 * @returns {Promise<{text: string, usage: object, exitCode: number}>}
 */
export async function runMiniMaxPrompt(prompt, options = {}) {
  const {
    model,
    timeout = DEFAULT_TIMEOUT_MS,
    systemPrompt,
    maxTokens,
    temperature,
  } = options;

  const resolvedModel = normalizeRequestedModel(model);
  const apiKey = getApiKey();

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body = {
    model: resolvedModel,
    messages,
  };

  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  if (temperature != null) {
    body.temperature = temperature;
  }

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || data?.detail || JSON.stringify(data);
      return {
        text: `MiniMax API Error (${response.status}): ${errorMsg}`,
        usage: null,
        exitCode: 1,
      };
    }

    // Extract text from response, strip reasoning <think> tags
    let text = data?.choices?.[0]?.message?.content ?? "(No text response)";
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

    return {
      text,
      usage: data.usage || null,
      exitCode: 0,
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        text: `MiniMax API timed out after ${timeout}ms`,
        usage: null,
        exitCode: 1,
      };
    }
    return {
      text: `MiniMax API Error: ${err.message}`,
      usage: null,
      exitCode: 1,
    };
  }
}

/**
 * Load a prompt template from the prompts/ directory.
 */
export async function loadPromptTemplate(name) {
  const currentPath = fileURLToPath(import.meta.url);
  const dir = path.resolve(path.dirname(currentPath), "../../prompts");
  const filePath = path.join(dir, `${name}.md`);
  return readFile(filePath, "utf-8");
}

/**
 * Simple template interpolation: replaces {{key}} with values.
 */
export function interpolateTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}
