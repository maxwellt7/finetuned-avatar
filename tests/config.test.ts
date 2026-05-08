import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FAL_API_KEY;
    delete process.env.PHOTOS_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when FAL_API_KEY is missing", () => {
    expect(() => loadConfig()).toThrow(/FAL_API_KEY/);
  });

  it("returns config with defaults when env is set", () => {
    process.env.FAL_API_KEY = "test-key";
    const cfg = loadConfig();
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.triggerWord).toBe("MAXAVATAR");
    expect(cfg.queueBase).toBe("https://queue.fal.run");
    expect(cfg.storageBase).toBe("https://rest.alpha.fal.ai");
    expect(cfg.photosDir).toContain("pics of me");
    expect(cfg.cacheFile).toMatch(/cache\/finetune\.json$/);
    expect(cfg.outputDir).toMatch(/output$/);
  });

  it("uses PHOTOS_DIR override if set", () => {
    process.env.FAL_API_KEY = "test-key";
    process.env.PHOTOS_DIR = "/tmp/custom";
    const cfg = loadConfig();
    expect(cfg.photosDir).toBe("/tmp/custom");
  });
});
