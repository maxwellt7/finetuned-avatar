import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitFinetune } from "../src/bfl.js";

describe("submitFinetune", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /finetune with auth header and payload, returns finetune_id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ finetune_id: "ft_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await submitFinetune(
      { apiKey: "k", apiBase: "https://api.test/v1" } as any,
      {
        file_data: "ZmFrZQ==",
        finetune_comment: "x",
        trigger_word: "MAXAVATAR",
        mode: "character",
        iterations: 300,
        captioning: true,
        priority: "quality",
        finetune_type: "full",
      }
    );

    expect(id).toBe("ft_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/v1/finetune");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-key"]).toBe("k");
  });

  it("throws on 401 with a clear message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 }))
    );
    await expect(
      submitFinetune({ apiKey: "k", apiBase: "https://api.test/v1" } as any, {
        file_data: "x",
        finetune_comment: "x",
        trigger_word: "x",
        mode: "character",
        iterations: 1,
        captioning: true,
        priority: "quality",
        finetune_type: "full",
      })
    ).rejects.toThrow(/auth/i);
  });
});

import { getResult } from "../src/bfl.js";

describe("getResult", () => {
  it("GETs /get_result?id=...", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "Ready", result: { sample: "https://x/y.png" } }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getResult(
      { apiKey: "k", apiBase: "https://api.test/v1" } as any,
      "ft_123"
    );

    expect(result.status).toBe("Ready");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.test/v1/get_result?id=ft_123"
    );
  });
});

import { generate } from "../src/bfl.js";

describe("generate", () => {
  it("submits then polls until Ready and returns image URL", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/flux-pro-1.1-ultra-finetuned")) {
        return new Response(
          JSON.stringify({ id: "task_abc", polling_url: "https://api.test/v1/get_result?id=task_abc" }),
          { status: 200 }
        );
      }
      // Second poll = Ready
      if (calls.filter((c) => c.includes("get_result")).length < 2) {
        return new Response(JSON.stringify({ status: "Pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "Ready", result: { sample: "https://cdn/x.png" } }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generate(
      { apiKey: "k", apiBase: "https://api.test/v1" } as any,
      {
        finetune_id: "ft_123",
        finetune_strength: 1.2,
        prompt: "MAXAVATAR test",
        aspect_ratio: "1:1",
        safety_tolerance: 2,
        output_format: "png",
      },
      { pollIntervalMs: 1, maxAttempts: 10 }
    );

    expect(result.imageUrl).toBe("https://cdn/x.png");
    expect(result.taskId).toBe("task_abc");
  });

  it("throws when status is Content Moderated", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/flux-pro-1.1-ultra-finetuned")) {
        return new Response(
          JSON.stringify({ id: "t", polling_url: "https://api.test/v1/get_result?id=t" }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ status: "Content Moderated" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generate(
        { apiKey: "k", apiBase: "https://api.test/v1" } as any,
        {
          finetune_id: "ft_123",
          finetune_strength: 1.2,
          prompt: "x",
          aspect_ratio: "1:1",
          safety_tolerance: 2,
          output_format: "png",
        },
        { pollIntervalMs: 1, maxAttempts: 5 }
      )
    ).rejects.toThrow(/moderated/i);
  });
});
