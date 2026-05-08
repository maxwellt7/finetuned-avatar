import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { runTrain } from "../../src/commands/train.js";

const tmp = join(tmpdir(), `avatar-train-${Date.now()}`);
const photosDir = join(tmp, "pics");
const cacheFile = join(tmp, "cache", "finetune.json");

beforeEach(async () => {
  mkdirSync(photosDir, { recursive: true });
  const img = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#777" },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(join(photosDir, "p1.jpg"), img);
  writeFileSync(join(photosDir, "p2.jpg"), img);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/storage/upload/initiate")) {
        return new Response(
          JSON.stringify({
            file_url: "https://cdn/zip.zip",
            upload_url: "https://signed.test/put",
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/fal-ai/flux-lora-portrait-trainer")) {
        return new Response(
          JSON.stringify({
            request_id: "req_xyz",
            status_url: "https://queue.test/status",
            response_url: "https://queue.test/response",
          }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 200 });
    })
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runTrain", () => {
  it("uploads zip, submits training, and writes cache file", async () => {
    const cfg = {
      apiKey: "k",
      queueBase: "https://queue.test",
      storageBase: "https://storage.test",
      triggerWord: "MAXAVATAR",
      photosDir,
      cacheFile,
      outputDir: join(tmp, "out"),
    };

    const id = await runTrain(cfg);

    expect(id).toBe("req_xyz");
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.id).toBe("req_xyz");
    expect(cached.statusUrl).toBe("https://queue.test/status");
    expect(cached.responseUrl).toBe("https://queue.test/response");
    expect(cached.imagesDataUrl).toBe("https://cdn/zip.zip");
    expect(cached.trigger).toBe("MAXAVATAR");
    expect(cached.status).toBe("Pending");
    expect(cached.photoCount).toBe(1); // p1 and p2 are duplicates
  });
});
