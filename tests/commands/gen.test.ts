import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runGen } from "../../src/commands/gen.js";

const tmp = join(tmpdir(), `avatar-gen-${Date.now()}`);
const cacheFile = join(tmp, "cache", "finetune.json");
const outputDir = join(tmp, "output");

beforeEach(() => {
  mkdirSync(dirname(cacheFile), { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    cacheFile,
    JSON.stringify({ id: "ft_a", trigger: "MAXAVATAR", status: "Ready" })
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
      if (url.endsWith("/flux-pro-1.1-ultra-finetuned")) {
        return new Response(
          JSON.stringify({ id: "task_1", polling_url: "https://api.test/v1/get_result?id=task_1" }),
          { status: 200 }
        );
      }
      if (url.includes("get_result")) {
        return new Response(
          JSON.stringify({ status: "Ready", result: { sample: "https://cdn/img.png" } }),
          { status: 200 }
        );
      }
      // image download
      return new Response(fakePng, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir,
    };

    const paths = await runGen(cfg, "MAXAVATAR in a tuxedo on a Miami rooftop", {
      count: 1,
      aspectRatio: "1:1",
      strength: 1.2,
      open: false,
      pollIntervalMs: 1,
    });

    expect(paths).toHaveLength(1);
    const pngs = readdirSync(outputDir).filter((f) => f.endsWith(".png"));
    const jsons = readdirSync(outputDir).filter((f) => f.endsWith(".json"));
    expect(pngs).toHaveLength(1);
    expect(jsons).toHaveLength(1);
    const meta = JSON.parse(readFileSync(join(outputDir, jsons[0]), "utf8"));
    expect(meta.prompt).toContain("tuxedo");
    expect(meta.finetune_id).toBe("ft_a");
  });

  it("rejects count > 4", async () => {
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir,
    };
    await expect(
      runGen(cfg, "x", { count: 5, aspectRatio: "1:1", strength: 1.2, open: false })
    ).rejects.toThrow(/max 4/i);
  });

  it("errors when finetune not Ready", async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ id: "ft_a", trigger: "MAXAVATAR", status: "Pending" })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "Pending" }), { status: 200 })
      )
    );
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir,
    };
    await expect(
      runGen(cfg, "x", { count: 1, aspectRatio: "1:1", strength: 1.2, open: false })
    ).rejects.toThrow(/still training/i);
  });
});
