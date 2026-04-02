/**
 * Core module: Google Gemini image generation API client.
 * Wraps the generateContent endpoint for image generation, editing, and variations.
 */

import fs from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const DEFAULT_IMAGE_MODEL = "gemini-2.0-flash-exp";
const DEFAULT_TEXT_MODEL = "gemini-2.0-flash-exp";

const MODEL_ALIASES = new Map([
  ["pro", "gemini-2.5-pro-preview-06-05"],
  ["flash", "gemini-2.0-flash-exp"],
  ["flash-image", "gemini-2.0-flash-exp"],
]);

/**
 * Resolve model aliases to full model IDs.
 */
export function normalizeModel(model, forImage = true) {
  if (!model) return forImage ? DEFAULT_IMAGE_MODEL : DEFAULT_TEXT_MODEL;
  return MODEL_ALIASES.get(model.toLowerCase()) ?? model;
}

/**
 * Get the API key from environment.
 */
function getApiKey() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_API_KEY environment variable is not set.\n" +
      "Get your key at https://aistudio.google.com/apikey"
    );
  }
  return key;
}

/**
 * Check if the Gemini API is reachable and the key is valid.
 */
export async function getBananaAvailability() {
  try {
    const key = getApiKey();

    // List models as a health check
    const response = await fetch(
      `${API_BASE}/models?key=${encodeURIComponent(key)}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (response.ok) {
      return { available: true, error: null };
    }

    const errorBody = await response.text().catch(() => "");
    return {
      available: false,
      error: `API returned ${response.status}: ${errorBody.slice(0, 200)}`,
    };
  } catch (err) {
    if (err.message.includes("GOOGLE_API_KEY")) {
      return { available: false, error: err.message };
    }
    return { available: false, error: `Connection failed: ${err.message}` };
  }
}

/**
 * Read an image file and return { mimeType, data } for inline_data.
 */
export function readImageAsBase64(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image file not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeMap = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };

  const mimeType = mimeMap[ext] || "image/png";
  const data = fs.readFileSync(resolved).toString("base64");
  return { mimeType, data };
}

/**
 * Generate a descriptive filename for a saved image.
 */
export function generateImageFilename(prefix = "banana") {
  const ts = Date.now();
  return `${prefix}-${ts}.png`;
}

/**
 * Save a base64-encoded image to the working directory.
 * Returns the absolute path to the saved file.
 */
export function saveBase64Image(base64Data, outputDir, filename) {
  const buffer = Buffer.from(base64Data, "base64");
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Generate an image from a text prompt.
 *
 * @param {string} prompt - The image generation prompt
 * @param {object} options
 * @param {string} [options.model] - Model override (or alias)
 * @param {string} [options.aspect] - Aspect ratio (e.g., "16:9", "1:1")
 * @param {string} [options.size] - Image size ("512", "1K", "2K", "4K")
 * @param {number} [options.timeout] - Timeout in ms
 * @param {string} [options.outputDir] - Directory to save image to
 * @returns {Promise<{text: string, imagePath: string|null, exitCode: number}>}
 */
export async function generateImage(prompt, options = {}) {
  const {
    model,
    aspect,
    size,
    timeout = DEFAULT_TIMEOUT_MS,
    outputDir = process.cwd(),
  } = options;

  const resolvedModel = normalizeModel(model, true);
  const apiKey = getApiKey();

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  // Add image config if aspect ratio or size specified
  if (aspect || size) {
    body.generationConfig.imageConfig = {};
    if (aspect) body.generationConfig.imageConfig.aspectRatio = aspect;
    if (size) body.generationConfig.imageConfig.imageSize = size;
  }

  try {
    const url = `${API_BASE}/models/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg =
        data?.error?.message || data?.error?.status || JSON.stringify(data);
      return {
        text: `Gemini API Error (${response.status}): ${errorMsg}`,
        imagePath: null,
        exitCode: 1,
      };
    }

    return processImageResponse(data, outputDir, "banana");
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        text: `Gemini API timed out after ${timeout}ms`,
        imagePath: null,
        exitCode: 1,
      };
    }
    return {
      text: `Gemini API Error: ${err.message}`,
      imagePath: null,
      exitCode: 1,
    };
  }
}

/**
 * Edit an existing image based on a text prompt.
 *
 * @param {string} imagePath - Path to the source image
 * @param {string} prompt - Edit instructions
 * @param {object} options
 * @returns {Promise<{text: string, imagePath: string|null, exitCode: number}>}
 */
export async function editImage(imagePath, prompt, options = {}) {
  const {
    model,
    timeout = DEFAULT_TIMEOUT_MS,
    outputDir = process.cwd(),
  } = options;

  const resolvedModel = normalizeModel(model, true);
  const apiKey = getApiKey();
  const imageData = readImageAsBase64(imagePath);

  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: imageData.mimeType,
              data: imageData.data,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  try {
    const url = `${API_BASE}/models/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg =
        data?.error?.message || data?.error?.status || JSON.stringify(data);
      return {
        text: `Gemini API Error (${response.status}): ${errorMsg}`,
        imagePath: null,
        exitCode: 1,
      };
    }

    return processImageResponse(data, outputDir, "banana-edit");
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        text: `Gemini API timed out after ${timeout}ms`,
        imagePath: null,
        exitCode: 1,
      };
    }
    return {
      text: `Gemini API Error: ${err.message}`,
      imagePath: null,
      exitCode: 1,
    };
  }
}

/**
 * Generate variations of an existing image.
 *
 * @param {string} imagePath - Path to the source image
 * @param {object} options
 * @returns {Promise<{text: string, imagePath: string|null, exitCode: number}>}
 */
export async function generateVariations(imagePath, options = {}) {
  const prompt =
    "Generate a creative variation of this image. Keep the core subject and composition " +
    "but explore different styles, colors, lighting, or artistic interpretations.";
  return editImage(imagePath, prompt, {
    ...options,
    outputDir: options.outputDir || process.cwd(),
  });
}

/**
 * Send a general text query to Gemini (no image generation).
 *
 * @param {string} prompt - The text prompt
 * @param {object} options
 * @returns {Promise<{text: string, exitCode: number}>}
 */
export async function askGemini(prompt, options = {}) {
  const {
    model,
    timeout = DEFAULT_TIMEOUT_MS,
    systemPrompt,
  } = options;

  const resolvedModel = normalizeModel(model, false);
  const apiKey = getApiKey();

  const contents = [];
  if (systemPrompt) {
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const body = {
    contents,
    generationConfig: {
      responseModalities: ["TEXT"],
    },
  };

  try {
    const url = `${API_BASE}/models/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg =
        data?.error?.message || data?.error?.status || JSON.stringify(data);
      return {
        text: `Gemini API Error (${response.status}): ${errorMsg}`,
        exitCode: 1,
      };
    }

    const textParts = [];
    if (data.candidates) {
      for (const candidate of data.candidates) {
        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) textParts.push(part.text);
          }
        }
      }
    }

    return {
      text: textParts.join("\n") || "(No text response)",
      exitCode: 0,
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        text: `Gemini API timed out after ${timeout}ms`,
        exitCode: 1,
      };
    }
    return {
      text: `Gemini API Error: ${err.message}`,
      exitCode: 1,
    };
  }
}

/**
 * Process a Gemini generateContent response that may contain images.
 */
function processImageResponse(data, outputDir, filenamePrefix) {
  const textParts = [];
  let savedImagePath = null;

  if (data.candidates) {
    for (const candidate of data.candidates) {
      if (!candidate.content?.parts) continue;
      for (const part of candidate.content.parts) {
        if (part.text) {
          textParts.push(part.text);
        }
        if (part.inlineData?.data) {
          // Save the image
          const filename = generateImageFilename(filenamePrefix);
          savedImagePath = saveBase64Image(
            part.inlineData.data,
            outputDir,
            filename
          );
          textParts.push(`Image saved: ${savedImagePath}`);
        }
      }
    }
  }

  if (!savedImagePath && !textParts.length) {
    // Check for blocked content
    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      return {
        text: "Image generation was blocked by safety filters. Try a different prompt.",
        imagePath: null,
        exitCode: 1,
      };
    }
    return {
      text: "No image or text was returned. The model may not support image generation with the current settings.",
      imagePath: null,
      exitCode: 1,
    };
  }

  return {
    text: textParts.join("\n") || "Image generated successfully.",
    imagePath: savedImagePath,
    exitCode: 0,
  };
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
