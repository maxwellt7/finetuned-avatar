import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runList } from "../../src/commands/list.js";

const tmp = join(tmpdir(), `avatar-list-${Date.now()}`);
const outputDir = join(tmp, "output");

beforeEach(() => {
  mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runList", () => {
  it("returns an empty array when no generations exist", async () => {
    const result = await runList({ outputDir } as any);
    expect(result).toEqual([]);
  });

  it("lists generations sorted by timestamp descending", async () => {
    writeFileSync(
      join(outputDir, "2026-05-06T10-00-00-000-foo.json"),
      JSON.stringify({ prompt: "foo prompt", generated_at: "2026-05-06T10:00:00Z" })
    );
    writeFileSync(join(outputDir, "2026-05-06T10-00-00-000-foo.png"), "");
    writeFileSync(
      join(outputDir, "2026-05-06T11-00-00-000-bar.json"),
      JSON.stringify({ prompt: "bar prompt", generated_at: "2026-05-06T11:00:00Z" })
    );
    writeFileSync(join(outputDir, "2026-05-06T11-00-00-000-bar.png"), "");

    const result = await runList({ outputDir } as any);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("bar prompt"); // newer first
    expect(result[1].prompt).toBe("foo prompt");
  });
});
