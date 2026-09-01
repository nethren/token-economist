import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const HOST = "127.0.0.1";
const PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SYSTEM_CHARS = 50_000;
const MAX_USER_CHARS = 20_000;
const HARD_MAX_TOKENS = 1024;

export const MODEL_PROVIDERS = Object.freeze({
  "claude-opus-4-8": "anthropic",
  "claude-sonnet-5": "anthropic",
  "claude-haiku-4-5": "anthropic",
  "gpt-5": "openai",
  "gpt-5-mini": "openai",
  "gemini-2.5-pro": "google",
  "gemini-2.5-flash": "google",
});

const KEY_NAMES = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
});

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadLocalEnv() {
  try {
    return parseEnvText(await readFile(resolve(process.cwd(), ".env.local"), "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

export function validateCompletionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  const { provider, modelId, system, user, maxTokens } = value;
  if (!Object.hasOwn(KEY_NAMES, provider)) {
    throw new RequestError(400, "Unsupported provider.");
  }
  if (typeof modelId !== "string" || MODEL_PROVIDERS[modelId] !== provider) {
    throw new RequestError(400, "Model is not allowed for this provider.");
  }
  if (typeof system !== "string" || system.length > MAX_SYSTEM_CHARS) {
    throw new RequestError(400, `System prompt must be at most ${MAX_SYSTEM_CHARS} characters.`);
  }
  if (typeof user !== "string" || !user.trim() || user.length > MAX_USER_CHARS) {
    throw new RequestError(400, `Test input must be 1–${MAX_USER_CHARS} characters.`);
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > HARD_MAX_TOKENS) {
    throw new RequestError(400, `maxTokens must be an integer from 16 to ${HARD_MAX_TOKENS}.`);
  }
  return { provider, modelId, system, user, maxTokens };
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function safeTokenMatch(presented, expected) {
  if (typeof presented !== "string" || !expected || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

function requestIsLocal(req, proxyToken) {
  try {
    const hostUrl = new URL(`http://${req.headers.host || ""}`);
    if (!isLoopbackHostname(hostUrl.hostname) || hostUrl.port !== String(PORT)) return false;
    const origin = req.headers.origin;
    if (origin) {
      const originUrl = new URL(origin);
      if (!isLoopbackHostname(originUrl.hostname) || originUrl.port !== "5173") return false;
    }
    return safeTokenMatch(req.headers["x-quality-lab-proxy-token"], proxyToken);
  } catch {
    return false;
  }
}

async function readJson(req) {
  let size = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new RequestError(413, "Request body is too large.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

function providerMessage(data) {
  const message = data?.error?.message || data?.error || data?.message;
  return typeof message === "string" ? message.slice(0, 500) : "";
}

async function upstreamJson(url, init, providerName) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network failure";
    throw new RequestError(502, `${providerName} request failed: ${message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = providerMessage(data);
    throw new RequestError(
      502,
      `${providerName} rejected the request (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  return data;
}

async function completeAnthropic(request, apiKey) {
  const data = await upstreamJson(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.modelId,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      }),
    },
    "Anthropic",
  );
  return {
    text: (data.content || [])
      .filter((block) => block?.type === "text")
      .map((block) => block.text)
      .join(""),
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

async function completeOpenAI(request, apiKey) {
  const data = await upstreamJson(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.modelId,
        max_completion_tokens: request.maxTokens,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
    },
    "OpenAI",
  );
  return {
    text: data.choices?.[0]?.message?.content || "",
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

async function completeGoogle(request, apiKey) {
  const model = encodeURIComponent(request.modelId);
  const data = await upstreamJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: { maxOutputTokens: request.maxTokens },
      }),
    },
    "Google",
  );
  return {
    text: (data.candidates?.[0]?.content?.parts || [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join(""),
    inputTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
  };
}

const COMPLETERS = Object.freeze({
  anthropic: completeAnthropic,
  openai: completeOpenAI,
  google: completeGoogle,
});

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export async function startQualityProxy() {
  const proxyToken = process.env.QUALITY_LAB_PROXY_TOKEN;
  if (!proxyToken) {
    throw new Error("Quality Lab must be started with npm run dev:quality.");
  }
  const fileEnv = await loadLocalEnv();
  const keyFor = (provider) => process.env[KEY_NAMES[provider]] || fileEnv[KEY_NAMES[provider]] || "";
  const configuredProviders = Object.keys(KEY_NAMES).filter((provider) => Boolean(keyFor(provider)));

  const server = createServer(async (req, res) => {
    try {
      if (!requestIsLocal(req, proxyToken)) {
        throw new RequestError(403, "Only the local Token Economist app may use this service.");
      }

      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      if (req.method === "GET" && url.pathname === "/api/quality/status") {
        sendJson(res, 200, { available: true, configuredProviders });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/quality/complete") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
          throw new RequestError(415, "Content-Type must be application/json.");
        }
        const request = validateCompletionRequest(await readJson(req));
        const apiKey = keyFor(request.provider);
        if (!apiKey) {
          throw new RequestError(
            503,
            `${KEY_NAMES[request.provider]} is not configured in the server environment.`,
          );
        }
        sendJson(res, 200, await COMPLETERS[request.provider](request, apiKey));
        return;
      }
      throw new RequestError(404, "Not found.");
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      sendJson(res, status, { error: message });
    }
  });

  server.listen(PORT, HOST, () => {
    const providers = configuredProviders.length ? configuredProviders.join(", ") : "none";
    console.log(`Quality Lab service: http://${HOST}:${PORT} (configured: ${providers})`);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const server = await startQualityProxy();
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
