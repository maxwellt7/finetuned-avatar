import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  submitFinetune,
  getRequestStatus,
  getTrainResult,
  generate,
  uploadZip,
} from "../src/fal.js";

const cfg = {
  apiKey: "k",
  queueBase: "https://queue.test",
  storageBase: "https://storage.test",
} as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("submitFinetune", () => {
  it("POSTs to the trainer endpoint and returns request URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: "req_1",
          status_url: "https://queue.test/status",
          response_url: "https://queue.test/response",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await submitFinetune(cfg, {
      images_data_url: "https://x/y.zip",
      trigger_phrase: "MAXAVATAR",
    });

    expect(out.requestId).toBe("req_1");
    expect(out.statusUrl).toBe("https://queue.test/status");
    expect(out.responseUrl).toBe("https://queue.test/response");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://queue.test/fal-ai/flux-lora-portrait-trainer");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Key k");
  });

  it("throws on 401 with a clear message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 }))
    );
    await expect(
      submitFinetune(cfg, { images_data_url: "x", trigger_phrase: "X" })
    ).rejects.toThrow(/auth/i);
  });
});

describe("getRequestStatus", () => {
  it("GETs the provided statusUrl with auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "IN_QUEUE", queue_position: 2 }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await getRequestStatus(cfg, "https://queue.test/status");
    expect(out.status).toBe("IN_QUEUE");
    expect(out.queue_position).toBe(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://queue.test/status");
  });
});

describe("getTrainResult", () => {
  it("returns the diffusers_lora_file URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            diffusers_lora_file: { url: "https://cdn/lora.safetensors" },
          }),
          { status: 200 }
        )
      )
    );
    const out = await getTrainResult(cfg, "https://queue.test/response");
    expect(out.diffusers_lora_file.url).toBe(
      "https://cdn/lora.safetensors"
    );
  });
});

describe("generate", () => {
  it("submits then polls until COMPLETED, fetches final result, returns image URLs", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/fal-ai/flux-lora")) {
        return new Response(
          JSON.stringify({
            request_id: "req_g",
            status_url: "https://queue.test/g/status",
            response_url: "https://queue.test/g/response",
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/g/status")) {
        const polls = calls.filter((c) => c.endsWith("/g/status")).length;
        const status = polls < 2 ? "IN_QUEUE" : "COMPLETED";
        return new Response(JSON.stringify({ status }), { status: 200 });
      }
      if (url.endsWith("/g/response")) {
        return new Response(
          JSON.stringify({
            images: [
              { url: "https://cdn/a.png" },
              { url: "https://cdn/b.png" },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await generate(
      cfg,
      {
        prompt: "MAXAVATAR test",
        loras: [{ path: "https://cdn/lora.safetensors", scale: 1 }],
        num_images: 2,
      },
      { pollIntervalMs: 1, maxAttempts: 10 }
    );
    expect(out).toHaveLength(2);
    expect(out[0].imageUrl).toBe("https://cdn/a.png");
    expect(out[0].taskId).toBe("req_g");
  });

  it("throws when status is FAILED", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/fal-ai/flux-lora")) {
        return new Response(
          JSON.stringify({
            request_id: "r",
            status_url: "https://queue.test/g/status",
            response_url: "https://queue.test/g/response",
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ status: "FAILED" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      generate(
        cfg,
        { prompt: "x", loras: [{ path: "x", scale: 1 }] },
        { pollIntervalMs: 1, maxAttempts: 5 }
      )
    ).rejects.toThrow(/failed/i);
  });
});

describe("uploadZip", () => {
  it("initiates upload then PUTs bytes, returns file_url", async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith("/storage/upload/initiate")) {
        return new Response(
          JSON.stringify({
            file_url: "https://cdn/f.zip",
            upload_url: "https://signed.test/put",
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = await uploadZip(cfg, Buffer.from("PK\x03\x04test"));
    expect(url).toBe("https://cdn/f.zip");
    expect(calls[0].url).toBe("https://storage.test/storage/upload/initiate");
    expect(calls[1].url).toBe("https://signed.test/put");
    expect(calls[1].method).toBe("PUT");
  });
});
