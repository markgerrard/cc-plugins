/**
 * Argument parsing utilities for banana-companion.
 */

/**
 * Parse a raw argument string (as Claude Code passes it) into tokens.
 * Handles quoted strings and basic escaping.
 */
export function splitRawArgumentString(raw) {
  if (!raw) return [];
  const tokens = [];
  let current = "";
  let inQuote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      current += raw[++i];
      continue;
    }
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Parse tokens into { flags, positional }.
 * Known flags:  --background, --model <val>, --file <val> (repeatable), --json, --all, --aspect <val>, --size <val>
 *
 * --file can be repeated to pass multiple reference images in a single
 * generation call. When repeated, flags.file is an array; when given
 * once, it remains a string for backward compatibility.
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      // Boolean flags
      if (["background", "json", "all"].includes(key)) {
        flags[key] = true;
        i++;
        continue;
      }
      // Repeatable file flag — accumulates into an array
      if (key === "file" && i + 1 < argv.length) {
        const value = argv[++i];
        if (flags.file === undefined) {
          flags.file = value;
        } else if (Array.isArray(flags.file)) {
          flags.file.push(value);
        } else {
          flags.file = [flags.file, value];
        }
        i++;
        continue;
      }
      // Single-value flags
      if (["model", "kind", "aspect", "size"].includes(key) && i + 1 < argv.length) {
        flags[key] = argv[++i];
        i++;
        continue;
      }
      // Unknown flag — treat as positional
      positional.push(arg);
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { flags, positional };
}
