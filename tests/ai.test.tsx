import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LLM_MODEL,
  completeJson,
  draftModel,
  listOf,
  llmConfigured,
  llmCostUsd,
  textOf,
} from "../supabase/functions/_shared/llm";

/**
 * The drafting client's job is to turn a chat completion into a *validated*
 * value or refuse. These drive it against a stubbed endpoint, so the checks that
 * run here are the ones that decide whether a draft reaches a user.
 */

const env = new Map<string, string>();

/** One OpenAI-shaped completion reply. */
function completion(content: string, usage = { prompt_tokens: 200, completion_tokens: 100 }) {
  return { choices: [{ message: { content } }], usage, model: DEFAULT_LLM_MODEL };
}

/** A fetch stub that answers with the given completion bodies, in order. */
function stubEndpoint(bodies: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  let index = 0;

  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });

  return calls;
}

const SYSTEM = "Answer with JSON: {\"reply\": \"...\"}";

const PARSE_REPLY = (raw: Record<string, unknown>) => {
  const reply = textOf(raw.reply, 500);
  return reply.length >= 20 ? { reply } : null;
};

beforeEach(() => {
  env.clear();
  env.set("GROQ_API_KEY", "test-key");
  vi.stubGlobal("Deno", { env: { get: (name: string) => env.get(name) } });
});

describe("llm configuration", () => {
  it("reports whether a key is present, and names the model it will use", () => {
    expect(llmConfigured()).toBe(true);
    expect(draftModel()).toBe(DEFAULT_LLM_MODEL);

    env.clear();
    expect(llmConfigured()).toBe(false);
  });

  it("lets the model be overridden without touching code", () => {
    env.set("LLM_MODEL", "openai/gpt-oss-20b");
    expect(draftModel()).toBe("openai/gpt-oss-20b");
  });

  it("refuses rather than guessing when there is no key", async () => {
    env.clear();
    await expect(completeJson({ system: SYSTEM, user: "hi", parse: PARSE_REPLY })).rejects.toThrow(
      /GROQ_API_KEY/,
    );
  });
});

describe("cost accounting", () => {
  it("costs a call from its token counts, at six decimals", () => {
    // 1M prompt tokens at $0.15 and 1M completion tokens at $0.60.
    expect(llmCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it("keeps a real figure for a call far cheaper than a cent", () => {
    // The point of the precision change: a short reply must not round to zero,
    // or every AI row in the usage log would look free.
    const cost = llmCostUsd(200, 100);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
    expect(cost).toBe(Number(cost.toFixed(6)));
  });
});

describe("completeJson", () => {
  it("returns validated data with what it cost", async () => {
    const calls = stubEndpoint([completion('{"reply": "Thank you for the feedback, we appreciate it."}')]);

    const result = await completeJson({ system: SYSTEM, user: "the review", parse: PARSE_REPLY });

    expect(result.data.reply).toContain("Thank you");
    expect(result.promptTokens).toBe(200);
    expect(result.completionTokens).toBe(100);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.model).toBe(DEFAULT_LLM_MODEL);
    // JSON mode has to be requested, and the model named, or the endpoint
    // answers with prose we then have to reject.
    expect(calls[0].response_format).toEqual({ type: "json_object" });
    expect(calls[0].model).toBe(DEFAULT_LLM_MODEL);
  });

  it("accepts JSON a model wrapped in code fences", async () => {
    stubEndpoint([completion('```json\n{"reply": "Thank you for taking the time to tell us."}\n```')]);

    const result = await completeJson({ system: SYSTEM, user: "the review", parse: PARSE_REPLY });

    expect(result.data.reply).toContain("taking the time");
  });

  it("retries once with the reason, then accepts a corrected reply", async () => {
    const calls = stubEndpoint([
      completion("Sure! Here is a reply for you."),
      completion('{"reply": "Thanks for the feedback, we are on it."}'),
    ]);

    const result = await completeJson({ system: SYSTEM, user: "the review", parse: PARSE_REPLY });

    expect(result.data.reply).toContain("Thanks");
    expect(calls).toHaveLength(2);
    // The correction tells the model what was wrong, and the failed reply is
    // included so it can fix its own answer rather than starting over.
    const messages = (calls[1].messages ?? []) as { role: string; content: string }[];
    expect(messages.at(-1)?.content).toContain("not valid JSON");
    expect(messages.some((message) => message.role === "assistant")).toBe(true);
    // Both attempts are billed, so both are counted.
    expect(result.promptTokens).toBe(400);
    expect(result.completionTokens).toBe(200);
  });

  it("retries when the JSON is valid but the shape is wrong, and refuses after that", async () => {
    stubEndpoint([completion('{"reply": "too short"}'), completion('{"reply": "still short"}')]);

    await expect(
      completeJson({ system: SYSTEM, user: "the review", parse: PARSE_REPLY }),
    ).rejects.toThrow(/did not return usable JSON/);
  });

  it("refuses a bare array, which means the model answered something else", async () => {
    stubEndpoint([completion('["one", "two"]'), completion('["one", "two"]')]);

    await expect(
      completeJson({ system: SYSTEM, user: "the review", parse: PARSE_REPLY }),
    ).rejects.toThrow(/did not return usable JSON/);
  });
});

describe("reply helpers", () => {
  it("trims and bounds a string taken from a model reply", () => {
    expect(textOf("  hello  ", 10)).toBe("hello");
    expect(textOf("abcdefghij", 4)).toBe("abcd");
    expect(textOf(42, 10)).toBe("");
    expect(textOf(null, 10)).toBe("");
  });

  it("drops anything a model invented when only known values may be used", () => {
    const allowed = new Set(["running shoes", "trail shoes"]);

    const kept = listOf(["Running shoes", "designer sneakers", "TRAIL SHOES"], {
      max: 10,
      maxLength: 60,
      allowedLower: allowed,
    });

    // "designer sneakers" was never one of our suggestions, and the duplicate is
    // collapsed — which is what stops a cluster claiming an idea that does not
    // exist.
    expect(kept).toEqual(["Running shoes", "TRAIL SHOES"]);
  });

  it("bounds how many values survive", () => {
    expect(listOf(["a", "b", "c", "d"], { max: 2, maxLength: 10 })).toEqual(["a", "b"]);
    expect(listOf("not an array", { max: 2, maxLength: 10 })).toEqual([]);
  });
});
