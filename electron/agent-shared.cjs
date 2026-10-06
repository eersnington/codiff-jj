// @ts-check

const { accessSync, constants, statSync } = require('node:fs');
const { delimiter, join } = require('node:path');

// Backend-neutral helpers shared by the Codex and Claude Code agent backends.

/** @param {unknown} value @param {string} [fallback] */
const oneLine = (value, fallback = '') =>
  (typeof value === 'string' ? value : fallback).replace(/\s+/g, ' ').trim();

/** @param {string} value @param {number} maxLength */
const truncate = (value, maxLength) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
};

/** @param {unknown} value @param {string} [fallback] */
const cleanText = (value, fallback = '') =>
  oneLine(value, fallback).replace(/\s*\.{3}\[truncated]$/i, '');

/** @template T @param {unknown} value @param {ReadonlySet<T>} allowed @param {T} fallback */
const normalizeEnum = (value, allowed, fallback) =>
  allowed.has(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;

// Model ids come from the agent CLI, so accept any id-shaped value (for
// example `sonnet`, `gpt-6-sol`, or `claude-fable-5-1[1m]`) but never one that
// starts like a CLI flag.
const MODEL_ID_PATTERN = /^[a-z0-9][\w.:@/[\]-]*$/i;

/** @param {unknown} value @param {string} fallback @returns {string} */
const normalizeModelId = (value, fallback) => {
  const model = typeof value === 'string' ? value.trim() : '';
  return MODEL_ID_PATTERN.test(model) ? model : fallback;
};

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   description?: string;
 * }} AgentModel
 */

/**
 * Spawn a JSONL CLI, write `messages` to stdin, and resolve with the first
 * stdout message that `pick` maps to a value. The process is stopped as soon
 * as a value is picked, `pick` throws, the process exits, or the timeout ends.
 *
 * @template T
 * @param {{
 *   args: ReadonlyArray<string>;
 *   commandTransport: {command: string; spawn: typeof import('node:child_process').spawn};
 *   cwd: string;
 *   env: NodeJS.ProcessEnv;
 *   messages: ReadonlyArray<unknown>;
 *   pick: (message: any) => T | undefined;
 *   timeoutMs: number;
 * }} options
 * @returns {Promise<T>}
 */
const requestJsonLines = ({ args, commandTransport, cwd, env, messages, pick, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = commandTransport.spawn(commandTransport.command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let finished = false;
    let lineBuffer = '';
    let stderr = '';

    /** @param {Error | null} error @param {T} [value] */
    const finish = (error, value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (error) {
        reject(error);
      } else {
        resolve(/** @type {T} */ (value));
      }
    };

    const timer = setTimeout(
      () => finish(new Error(`${commandTransport.command} did not respond in time.`)),
      timeoutMs,
    );

    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        /** @type {unknown} */
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        try {
          const value = pick(message);
          if (value !== undefined) {
            finish(null, value);
            return;
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => finish(error));
    child.on('close', (code) =>
      finish(new Error(oneLine(stderr, `${commandTransport.command} exited with code ${code}.`))),
    );

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });

/**
 * Walk `text` and return the first balanced JSON object or array, or `null`
 * if none is found.
 *
 * @param {string} text
 * @returns {string | null}
 */
const extractFirstJson = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (c === '\\') {
          escape = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(i, j + 1);
        }
      }
    }
  }
  return null;
};

/** @param {unknown} schema @returns {ReadonlyArray<string>} */
const schemaRequiredFields = (schema) => {
  if (!schema || typeof schema !== 'object') return [];
  const required = /** @type {any} */ (schema).required;
  if (!Array.isArray(required)) return [];
  return required.filter((field) => typeof field === 'string');
};

/**
 * @param {unknown} parsed
 * @param {ReadonlyArray<string>} required
 * @returns {boolean}
 */
const hasAllRequiredFields = (parsed, required) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  for (const field of required) {
    if (!(field in parsed)) return false;
  }
  return true;
};

/**
 * @param {unknown} parsed
 * @param {unknown} schema
 * @returns {unknown}
 */
const coerceResultToSchema = (parsed, schema) => {
  const required = schemaRequiredFields(schema);
  if (!required.length || hasAllRequiredFields(parsed, required)) return parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  /** @type {Record<string, unknown>} */
  const next = { .../** @type {object} */ (parsed) };
  const aliases = [
    ['reply', 'text'],
    ['reply', 'response'],
    ['reply', 'answer'],
    ['reply', 'message'],
    ['reply', 'body'],
  ];
  for (const [target, alias] of aliases) {
    if (required.includes(target) && !(target in next) && alias in next) {
      next[target] = next[alias];
    }
  }
  return hasAllRequiredFields(next, required) ? next : parsed;
};

/** @param {unknown} schema @returns {string} */
const buildSchemaReminder = (schema) => {
  const required = schemaRequiredFields(schema);
  if (!schema || typeof schema !== 'object') return '';
  const requiredInstruction = required.length
    ? ` It must include the field${required.length === 1 ? '' : 's'} ${required
        .map((field) => `\`${field}\``)
        .join(', ')}.`
    : '';
  return `\n\nYour final reply must be a single JSON object.${requiredInstruction} Do not include any prose outside the JSON. Follow this JSON Schema exactly:\n${JSON.stringify(schema)}`;
};

/**
 * @param {string} output
 * @param {unknown} schema
 * @param {string} agentLabel
 * @returns {string}
 */
const normalizeStructuredOutput = (output, schema, agentLabel) => {
  const text = output.trim();
  const serialize = (value) => JSON.stringify(coerceResultToSchema(value, schema));

  try {
    return serialize(JSON.parse(text));
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return serialize(JSON.parse(fenced[1].trim()));
    } catch {}
  }

  const balanced = extractFirstJson(text);
  if (balanced) {
    try {
      return serialize(JSON.parse(balanced));
    } catch {}
  }

  if (text) {
    return JSON.stringify({ text });
  }

  throw new Error(`${agentLabel} did not produce a final answer.`);
};

/** @param {string} message @returns {unknown} */
const parseJSONMessage = (message) => {
  try {
    return JSON.parse(message);
  } catch {
    const match = message.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('The agent did not return JSON.');
    }

    return JSON.parse(match[0]);
  }
};

/** @param {string} path */
const isExecutableFile = (path) => {
  try {
    return statSync(path).isFile() && (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
};

/** @param {string} command */
const getExecutableNames = (command) => {
  if (process.platform !== 'win32') {
    return [command];
  }

  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
};

/** @param {string} command */
const findExecutableOnPath = (command) => {
  const path = process.env.PATH;
  if (!path) {
    return null;
  }

  for (const directory of path.split(delimiter)) {
    if (!directory) {
      continue;
    }

    for (const executable of getExecutableNames(command)) {
      const candidate = join(directory, executable);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

module.exports = {
  buildSchemaReminder,
  cleanText,
  findExecutableOnPath,
  isExecutableFile,
  normalizeEnum,
  normalizeModelId,
  normalizeStructuredOutput,
  oneLine,
  parseJSONMessage,
  requestJsonLines,
  truncate,
};
