import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/core/models";
import { runMeasurement, type ResultCache } from "../src/core/measure";
import { parseEnvText, validateCompletionRequest } from "../server/quality-proxy.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("Quality Lab browser boundary", () => {
  it("sends model inputs to the local route without any API credential", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({ text: "{}", inputTokens: 12, outputTokens: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const cache: ResultCache = {
      get: () => null,
      set: () => undefined,
    };
    const run = await runMeasurement({
      model: getModel("gemini-2.5-flash"),
      prompt: "Return JSON.",
      samples: ["hello"],
      check: { kind: "json" },
      maxTokens: 100,
      cache,
    });

    expect(requestUrl).toBe("/api/quality/complete");
    expect(requestInit?.method).toBe("POST");
    const serialized = JSON.stringify(requestInit);
    expect(serialized).not.toMatch(/apiKey|authorization|x-api-key|x-goog-api-key|sk-/i);
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      provider: "google",
      modelId: "gemini-2.5-flash",
      system: "Return JSON.",
      user: "hello",
      maxTokens: 100,
    });
    expect(run.results[0].output).toBe("{}");
  });
});

describe("Quality Lab server guardrails", () => {
  it("parses a minimal local env file without evaluating it", () => {
    expect(
      parseEnvText('OPENAI_API_KEY="openai-secret"\nexport GEMINI_API_KEY=gemini-secret\n# ignored'),
    ).toEqual({
      OPENAI_API_KEY: "openai-secret",
      GEMINI_API_KEY: "gemini-secret",
    });
  });

  it("allows only registered provider/model pairs and bounded token caps", () => {
    expect(
      validateCompletionRequest({
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        system: "Classify.",
        user: "A sample",
        maxTokens: 128,
      }),
    ).toMatchObject({ provider: "anthropic", modelId: "claude-haiku-4-5" });

    expect(() =>
      validateCompletionRequest({
        provider: "openai",
        modelId: "claude-haiku-4-5",
        system: "Classify.",
        user: "A sample",
        maxTokens: 128,
      }),
    ).toThrow(/not allowed/i);
    expect(() =>
      validateCompletionRequest({
        provider: "google",
        modelId: "gemini-2.5-pro",
        system: "Classify.",
        user: "A sample",
        maxTokens: 4096,
      }),
    ).toThrow(/maxTokens/i);
  });
});
