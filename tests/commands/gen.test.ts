import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runGen } from "../../src/commands/gen.js";

const tmp = join(tmpdir(), `avatar-gen-${Date.now()}`);
const cacheFile = join(tmp, "cache", "finetune.json");
const outputDir = join(tmp, "output");

const baseCfg = {
  apiKey: "k",
  queueBase: "https://queue.test",
  storageBase: "https://storage.test",
  triggerWord: "MAXAVATAR",
  photosDir: "",
};

beforeEach(() => {
  mkdirSync(dirname(cacheFile), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: "req_a",
      statusUrl: "https://queue.test/status",
      responseUrl: "https://queue.test/response",
      trigger: "MAXAVATAR",
      status: "COMPLETED",
      loraUrl: "https://cdn/lora.safetensors",
    })
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runGen", () => {
  it("generates an image, saves png + json sidecar, returns paths", async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/fal-ai/flux-lora")) {
        return new Response(
          JSON.stringify({
            request_id: "task_1",
            status_url: "https://queue.test/g/status",
            response_url: "https://queue.test/g/response",
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/g/status")) {
        return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      }
      if (url.endsWith("/g/response")) {
        return new Response(
          JSON.stringify({ images: [{ url: "https://cdn/img.png" }] }),
          { status: 200 }
        );
      }
      // image download
      return new Response(fakePng, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const paths = await runGen(
      { ...baseCfg, cacheFile, outputDir },
      "MAXAVATAR in a tuxedo on a Miami rooftop",
      {
        count: 1,
        aspectRatio: "1:1",
        strength: 1.0,
        open: false,
        pollIntervalMs: 1,
      }
    );

    expect(paths).toHaveLength(1);
    const pngs = readdirSync(outputDir).filter((f) => f.endsWith(".png"));
    const jsons = readdirSync(outputDir).filter((f) => f.endsWith(".json"));
    expect(pngs).toHaveLength(1);
    expect(jsons).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(outputDir, jsons[0]), "utf8"));
    expect(meta.prompt).toContain("tuxedo");
    expect(meta.lora_url).toBe("https://cdn/lora.safetensors");
  });

  it("rejects count > 4", async () => {
    await expect(
      runGen(
        { ...baseCfg, cacheFile, outputDir },
        "x",
        { count: 5, aspectRatio: "1:1", strength: 1.0, open: false }
      )
    ).rejects.toThrow(/max 4/i);
  });

  it("errors when training not yet COMPLETED", async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        id: "req_a",
        statusUrl: "https://queue.test/status",
        responseUrl: "https://queue.test/response",
        trigger: "MAXAVATAR",
        status: "Pending",
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "IN_QUEUE" }), { status: 200 })
      )
    );
    await expect(
      runGen(
        { ...baseCfg, cacheFile, outputDir },
        "x",
        { count: 1, aspectRatio: "1:1", strength: 1.0, open: false }
      )
    ).rejects.toThrow(/still training/i);
  });

  it("rejects unsupported aspect ratio", async () => {
    await expect(
      runGen(
        { ...baseCfg, cacheFile, outputDir },
        "x",
        { count: 1, aspectRatio: "21:9", strength: 1.0, open: false }
      )
    ).rejects.toThrow(/aspect ratio/i);
  });
});
