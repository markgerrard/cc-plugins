/**
 * Model registry — maps names to the companion commands that invoke them.
 * Each entry defines how to call the model via its plugin's companion script.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

// Default model set for compare/consensus
export const DEFAULT_MODELS = ["gemini", "grok", "glm"];

// Model definitions — how to call each one
const MODEL_REGISTRY = {
  codex: {
    name: "Codex",
    command: "ask",
    companion: "codex-companion.mjs",
    marketplace: "openai-codex",
    plugin: "codex",
  },
  gemini: {
    name: "Gemini",
    command: "ask",
    companion: "gemini-companion.mjs",
    marketplace: "google-gemini",
    plugin: "gemini",
  },
  grok: {
    name: "Grok",
    command: "ask",
    companion: "grok-companion.mjs",
    marketplace: "xai-grok",
    plugin: "grok",
  },
  glm: {
    name: "GLM",
    command: "ask",
    companion: "glm-companion.mjs",
    marketplace: "zhipu-glm",
    plugin: "glm",
  },
  minimax: {
    name: "MiniMax",
    command: "ask",
    companion: "minimax-companion.mjs",
    marketplace: "minimax",
    plugin: "minimax",
  },
};

/**
 * Resolve a model key to its full definition.
 */
export function getModel(key) {
  return MODEL_REGISTRY[key] || null;
}

/**
 * List all available model keys.
 */
export function listModels() {
  return Object.keys(MODEL_REGISTRY);
}

/**
 * Find the companion script path for a model by checking the plugin cache.
 */
export function resolveCompanionPath(model) {
  const def = MODEL_REGISTRY[model];
  if (!def) return null;

  const cacheBase = path.join(process.env.HOME || "", ".claude", "plugins", "cache");

  // Try common version patterns
  const versions = ["local", "1.0.0", "unknown"];
  for (const ver of versions) {
    const p = path.join(cacheBase, def.marketplace, def.plugin, ver, "scripts", def.companion);
    try {
      const stat = spawnSync("test", ["-f", p]);
      if (stat.status === 0) return p;
    } catch {
      // continue
    }
  }

  // Fallback: glob for any version
  const result = spawnSync("find", [
    path.join(cacheBase, def.marketplace),
    "-name", def.companion,
    "-type", "f",
  ], { encoding: "utf8", timeout: 5000 });

  if (result.stdout) {
    const first = result.stdout.trim().split("\n")[0];
    if (first) return first;
  }

  return null;
}

/**
 * Parse a model list string like "gemini,grok,glm" into an array.
 */
export function parseModelList(str) {
  if (!str) return DEFAULT_MODELS;
  return str.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
