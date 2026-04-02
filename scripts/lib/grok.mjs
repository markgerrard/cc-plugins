/**
 * Core module: xAI Grok API client.
 * Wraps the /v1/responses endpoint with built-in x_search and web_search tools.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.x.ai/v1";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

const MODEL_ALIASES = new Map([
  ["fast", "grok-4-1-fast-non-reasoning"],
  ["fast-reasoning", "grok-4-1-fast-reasoning"],
  ["reasoning", "grok-4.20-0309-reasoning"],
  ["pro", "grok-4.20-0309-non-reasoning"],
  ["pro-reasoning", "grok-4.20-0309-reasoning"],
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
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new Error("XAI_API_KEY environment variable is not set. Get your key at https://console.x.ai");
  }
  return key;
}

/**
 * Check if the xAI API is reachable and the key is valid.
 */
export async function getGrokAvailability() {
  try {
    const key = getApiKey();
    const response = await fetch(`${API_BASE}/api-key`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { available: true, error: null };
    }

    // Try a minimal completion as fallback health check
    const testResponse = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (testResponse.ok || testResponse.status === 200) {
      return { available: true, error: null };
    }

    const errorBody = await testResponse.text().catch(() => "");
    return { available: false, error: `API returned ${testResponse.status}: ${errorBody.slice(0, 200)}` };
  } catch (err) {
    if (err.message.includes("XAI_API_KEY")) {
      return { available: false, error: err.message };
    }
    return { available: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Send a request to the xAI Responses API with optional built-in tools.
 *
 * @param {string} prompt - The user prompt
 * @param {object} options
 * @param {string} [options.model] - Model override (or alias)
 * @param {Array} [options.tools] - Built-in tools config (x_search, web_search, functions)
 * @param {number} [options.timeout] - Timeout in ms
 * @param {string} [options.reasoningEffort] - 'low' or 'high' for reasoning models
 * @param {string} [options.systemPrompt] - System prompt
 * @returns {Promise<{text: string, citations: Array, usage: object, exitCode: number}>}
 */
export async function runGrokPrompt(prompt, options = {}) {
  const {
    model,
    tools,
    timeout = DEFAULT_TIMEOUT_MS,
    reasoningEffort,
    systemPrompt,
  } = options;

  const resolvedModel = normalizeRequestedModel(model);
  const apiKey = getApiKey();

  const input = [];
  if (systemPrompt) {
    input.push({ role: "system", content: systemPrompt });
  }
  input.push({ role: "user", content: prompt });

  const body = {
    model: resolvedModel,
    input,
  };

  if (tools?.length) {
    body.tools = tools;
  }

  if (reasoningEffort && resolvedModel.includes("reasoning")) {
    body.reasoning_effort = reasoningEffort;
  }

  try {
    const response = await fetch(`${API_BASE}/responses`, {
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
        text: `Grok API Error (${response.status}): ${errorMsg}`,
        citations: [],
        usage: null,
        exitCode: 1,
      };
    }

    // Extract text from response output
    const textParts = [];
    const citations = [];

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === "output_text") {
              textParts.push(block.text);
              if (Array.isArray(block.annotations)) {
                citations.push(...block.annotations);
              }
            }
          }
        }
      }
    }

    return {
      text: textParts.join("\n") || "(No text response)",
      citations,
      usage: data.usage || null,
      exitCode: 0,
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        text: `Grok API timed out after ${timeout}ms`,
        citations: [],
        usage: null,
        exitCode: 1,
      };
    }
    return {
      text: `Grok API Error: ${err.message}`,
      citations: [],
      usage: null,
      exitCode: 1,
    };
  }
}

/**
 * Build x_search tool config.
 */
export function buildXSearchTool(options = {}) {
  const tool = { type: "x_search" };
  if (options.handles?.length) tool.allowed_x_handles = options.handles;
  if (options.blockedHandles?.length) tool.blocked_x_handles = options.blockedHandles;
  if (options.fromDate) tool.from_date = options.fromDate;
  if (options.toDate) tool.to_date = options.toDate;
  return tool;
}

/**
 * Build web_search tool config.
 */
export function buildWebSearchTool(options = {}) {
  const tool = { type: "web_search" };
  if (options.domains?.length) tool.allowed_domains = options.domains;
  if (options.excludeDomains?.length) tool.excluded_domains = options.excludeDomains;
  return tool;
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
