import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runStatus } from "../../src/commands/status.js";

const tmp = join(tmpdir(), `avatar-status-${Date.now()}`);
const cacheFile = join(tmp, "cache", "finetune.json");

const baseCfg = {
  apiKey: "k",
  queueBase: "https://queue.test",
  storageBase: "https://storage.test",
  triggerWord: "MAXAVATAR",
  photosDir: "",
  outputDir: "",
};

beforeEach(() => {
  mkdirSync(dirname(cacheFile), { recursive: true });
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
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runStatus", () => {
  it("returns COMPLETED and writes loraUrl to cache when training is done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
        }
        if (url.endsWith("/response")) {
          return new Response(
            JSON.stringify({
              diffusers_lora_file: { url: "https://cdn/lora.safetensors" },
            }),
            { status: 200 }
          );
        }
        return new Response(null, { status: 404 });
      })
    );

    const status = await runStatus({ ...baseCfg, cacheFile });
    expect(status).toBe("COMPLETED");
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.status).toBe("COMPLETED");
    expect(cached.loraUrl).toBe("https://cdn/lora.safetensors");
  });

  it("throws if cache file missing", async () => {
    rmSync(cacheFile);
    await expect(
      runStatus({ ...baseCfg, cacheFile })
    ).rejects.toThrow(/avatar train/);
  });
});
