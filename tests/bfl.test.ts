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
