# Avatar BFL Finetune CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI (`avatar`) that trains a BFL Pro Finetune from photos in `~/Desktop/pics of me/` and generates images of Max from text prompts using the trigger word `MAXAVATAR`.

**Architecture:** Single Node 22 + TS package at `~/avatar/`. Three layers: a thin BFL HTTP client (`bfl.ts`), a pure file-prep module (`prepare.ts`), and command orchestrators (`commands/*.ts`) wired together by `cli.ts` via commander. State persists in `cache/finetune.json`; outputs land in `output/<timestamp>-<slug>.png` with sibling `.json` metadata.

**Tech Stack:** Node 22, TypeScript (ESM), `commander`, `archiver`, `sharp`, `dotenv`, `vitest` (test runner + built-in mocking), `tsx` for dev runs.

---

## File Structure

```
~/avatar/
├── .env                  # BFL_API_KEY (created manually, gitignored, chmod 600)
├── .env.example          # template, committed
├── .gitignore            # already exists
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── cli.ts                   # Task 12 — commander entrypoint
│   ├── config.ts                # Task 1 — env loading, paths, constants
│   ├── bfl.ts                   # Tasks 2-4 — BFL API client
│   ├── prepare.ts               # Tasks 5-7 — photo prep (dedupe, resize, zip)
│   └── commands/
│       ├── train.ts             # Task 8
│       ├── status.ts            # Task 9
│       ├── gen.ts               # Task 10
│       └── list.ts              # Task 11
├── tests/
│   ├── fixtures/                # small test images created in Task 5
│   ├── config.test.ts
│   ├── bfl.test.ts
│   ├── prepare.test.ts
│   └── commands/
│       ├── train.test.ts
│       ├── status.test.ts
│       ├── gen.test.ts
│       └── list.test.ts
├── cache/                # gitignored, holds finetune.json at runtime
└── output/               # gitignored, generated images + metadata
```

---

### Task 0: Scaffold the project

**Files:**
- Create: `~/avatar/package.json`
- Create: `~/avatar/tsconfig.json`
- Create: `~/avatar/vitest.config.ts`
- Create: `~/avatar/.env.example`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "avatar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "avatar": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -p .",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "archiver": "^7.0.1",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@types/archiver": "^6.0.2",
    "@types/node": "^22.7.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: Write `.env.example`**

```
BFL_API_KEY=
PHOTOS_DIR=/Users/maxmayes/Desktop/pics of me
```

- [ ] **Step 5: Install dependencies**

Run: `cd ~/avatar && npm install`
Expected: lockfile created, no install errors.

- [ ] **Step 6: Commit**

```bash
cd ~/avatar
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example
git commit -m "chore: scaffold TS project (commander, sharp, archiver, vitest)"
```

---

### Task 1: Config module

**Files:**
- Create: `~/avatar/src/config.ts`
- Test: `~/avatar/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BFL_API_KEY;
    delete process.env.PHOTOS_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when BFL_API_KEY is missing", () => {
    expect(() => loadConfig()).toThrow(/BFL_API_KEY/);
  });

  it("returns config with defaults when env is set", () => {
    process.env.BFL_API_KEY = "test-key";
    const cfg = loadConfig();
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.triggerWord).toBe("MAXAVATAR");
    expect(cfg.apiBase).toBe("https://api.us1.bfl.ai/v1");
    expect(cfg.photosDir).toContain("pics of me");
    expect(cfg.cacheFile).toMatch(/cache\/finetune\.json$/);
    expect(cfg.outputDir).toMatch(/output$/);
  });

  it("uses PHOTOS_DIR override if set", () => {
    process.env.BFL_API_KEY = "test-key";
    process.env.PHOTOS_DIR = "/tmp/custom";
    const cfg = loadConfig();
    expect(cfg.photosDir).toBe("/tmp/custom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
// src/config.ts
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

export interface Config {
  apiKey: string;
  apiBase: string;
  triggerWord: string;
  photosDir: string;
  cacheFile: string;
  outputDir: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BFL_API_KEY is not set. Add it to ~/avatar/.env (chmod 600)."
    );
  }
  return {
    apiKey,
    apiBase: "https://api.us1.bfl.ai/v1",
    triggerWord: "MAXAVATAR",
    photosDir:
      process.env.PHOTOS_DIR ?? "/Users/maxmayes/Desktop/pics of me",
    cacheFile: join(projectRoot, "cache", "finetune.json"),
    outputDir: join(projectRoot, "output"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/config.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): load API key, paths, and trigger word from env"
```

---

### Task 2: BFL client — submitFinetune

**Files:**
- Create: `~/avatar/src/bfl.ts`
- Test: `~/avatar/tests/bfl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/bfl.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/bfl.ts` (initial)**

```ts
// src/bfl.ts
import type { Config } from "./config.js";

export interface FinetunePayload {
  file_data: string;
  finetune_comment: string;
  trigger_word: string;
  mode: "character" | "product" | "style" | "general";
  iterations: number;
  captioning: boolean;
  priority: "quality" | "speed";
  finetune_type: "full" | "lora";
}

async function bflFetch(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  path: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-key": cfg.apiKey,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("BFL auth failed — check your API key.");
  }
  if (res.status === 429) {
    throw new Error("BFL rate-limited (likely a billing issue).");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BFL ${path} returned ${res.status}: ${body}`);
  }
  return res;
}

export async function submitFinetune(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  payload: FinetunePayload
): Promise<string> {
  const res = await bflFetch(cfg, "/finetune", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { finetune_id: string };
  return body.finetune_id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/bfl.ts tests/bfl.test.ts
git commit -m "feat(bfl): add submitFinetune client"
```

---

### Task 3: BFL client — getResult

**Files:**
- Modify: `~/avatar/src/bfl.ts`
- Modify: `~/avatar/tests/bfl.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `tests/bfl.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: FAIL — `getResult` not exported.

- [ ] **Step 3: Append to `src/bfl.ts`**

```ts
export type FinetuneStatus =
  | "Pending"
  | "Ready"
  | "Error"
  | "Content Moderated"
  | "Task not found";

export interface BflResult {
  status: FinetuneStatus;
  result?: { sample?: string };
}

export async function getResult(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  id: string
): Promise<BflResult> {
  const res = await bflFetch(cfg, `/get_result?id=${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return (await res.json()) as BflResult;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/bfl.ts tests/bfl.test.ts
git commit -m "feat(bfl): add getResult client"
```

---

### Task 4: BFL client — generate (submit + poll)

**Files:**
- Modify: `~/avatar/src/bfl.ts`
- Modify: `~/avatar/tests/bfl.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `tests/bfl.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: FAIL — `generate` not exported.

- [ ] **Step 3: Append to `src/bfl.ts`**

```ts
export interface GeneratePayload {
  finetune_id: string;
  finetune_strength: number;
  prompt: string;
  aspect_ratio: string;
  safety_tolerance: number;
  output_format: "png" | "jpeg";
}

export interface GenerateOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface GenerateResult {
  imageUrl: string;
  taskId: string;
}

export async function generate(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  payload: GeneratePayload,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 80;

  const submitRes = await bflFetch(cfg, "/flux-pro-1.1-ultra-finetuned", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const submitBody = (await submitRes.json()) as {
    id: string;
    polling_url: string;
  };

  for (let i = 0; i < maxAttempts; i++) {
    const pollRes = await fetch(submitBody.polling_url, {
      headers: { "x-key": cfg.apiKey },
    });
    if (!pollRes.ok) {
      throw new Error(`Poll failed: ${pollRes.status}`);
    }
    const pollBody = (await pollRes.json()) as BflResult;
    if (pollBody.status === "Ready") {
      const url = pollBody.result?.sample;
      if (!url) throw new Error("Ready but no image URL returned.");
      return { imageUrl: url, taskId: submitBody.id };
    }
    if (pollBody.status === "Content Moderated") {
      throw new Error(
        "Generation was content-moderated. Try rephrasing the prompt."
      );
    }
    if (pollBody.status === "Error" || pollBody.status === "Task not found") {
      throw new Error(`Generation failed: ${pollBody.status}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    "Generation timed out — check `avatar list` later or retry."
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/bfl.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/bfl.ts tests/bfl.test.ts
git commit -m "feat(bfl): add generate with polling and moderation handling"
```

---

### Task 5: Photo prep — dedupe by SHA1

**Files:**
- Create: `~/avatar/src/prepare.ts`
- Create: `~/avatar/tests/prepare.test.ts`
- Create: `~/avatar/tests/fixtures/` (small JPEGs generated during test)

- [ ] **Step 1: Write the failing test**

```ts
// tests/prepare.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupeFiles } from "../src/prepare.js";

const tmp = join(tmpdir(), `avatar-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "a.jpg"), Buffer.from("AAAA"));
  writeFileSync(join(tmp, "b.jpg"), Buffer.from("BBBB"));
  writeFileSync(join(tmp, "a-copy.jpg"), Buffer.from("AAAA")); // duplicate of a.jpg
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("dedupeFiles", () => {
  it("returns only unique files (by content hash)", async () => {
    const result = await dedupeFiles(tmp);
    expect(result).toHaveLength(2);
    const names = result.map((p) => p.split("/").pop()).sort();
    expect(names).toEqual(["a-copy.jpg", "b.jpg"].sort()); // first hit by sort wins; either is fine
  });

  it("throws if directory is empty", async () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    await expect(dedupeFiles(empty)).rejects.toThrow(/no images/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/prepare.ts` (initial)**

```ts
// src/prepare.ts
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);

export async function dedupeFiles(dir: string): Promise<string[]> {
  const all = readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .sort();

  if (all.length === 0) {
    throw new Error(`No images found in ${dir}`);
  }

  const seen = new Map<string, string>();
  for (const path of all) {
    const hash = createHash("sha1").update(readFileSync(path)).digest("hex");
    if (!seen.has(hash)) seen.set(hash, path);
  }
  return Array.from(seen.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/prepare.ts tests/prepare.test.ts
git commit -m "feat(prepare): dedupe images by SHA1"
```

---

### Task 6: Photo prep — resize + EXIF strip

**Files:**
- Modify: `~/avatar/src/prepare.ts`
- Modify: `~/avatar/tests/prepare.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `tests/prepare.test.ts`:

```ts
import sharp from "sharp";
import { normalizeImage } from "../src/prepare.js";

describe("normalizeImage", () => {
  it("resizes long-edge to 2048 and strips EXIF", async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();

    const out = await normalizeImage(big);
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
  });

  it("leaves small images untouched in dimensions", async () => {
    const small = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#222" },
    })
      .jpeg()
      .toBuffer();
    const out = await normalizeImage(small);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: FAIL — `normalizeImage` not exported.

- [ ] **Step 3: Append to `src/prepare.ts`**

```ts
import sharp from "sharp";

export async function normalizeImage(buf: Buffer): Promise<Buffer> {
  const img = sharp(buf, { failOn: "none" }).rotate(); // honor + drop orientation EXIF
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const pipeline = longEdge > 2048 ? img.resize({ width: 2048, height: 2048, fit: "inside" }) : img;
  return pipeline.jpeg({ quality: 92, mozjpeg: true }).withMetadata({}).toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/prepare.ts tests/prepare.test.ts
git commit -m "feat(prepare): resize to 2048px long-edge and strip EXIF"
```

---

### Task 7: Photo prep — zip + base64 the training set

**Files:**
- Modify: `~/avatar/src/prepare.ts`
- Modify: `~/avatar/tests/prepare.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `tests/prepare.test.ts`:

```ts
import { buildTrainingZip } from "../src/prepare.js";

describe("buildTrainingZip", () => {
  it("returns a non-empty base64 string given a directory of images", async () => {
    const fixtures = join(tmp, "ftset");
    mkdirSync(fixtures, { recursive: true });
    const small = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#abc" },
    })
      .jpeg()
      .toBuffer();
    writeFileSync(join(fixtures, "p1.jpg"), small);
    writeFileSync(join(fixtures, "p2.jpg"), small); // duplicate hash -> deduped
    writeFileSync(
      join(fixtures, "p3.jpg"),
      await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } })
        .jpeg()
        .toBuffer()
    );

    const result = await buildTrainingZip(fixtures);
    expect(result.uniqueCount).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.base64.length).toBeGreaterThan(100);
    // base64 should decode to a zip (PK\x03\x04)
    const buf = Buffer.from(result.base64, "base64");
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: FAIL — `buildTrainingZip` not exported.

- [ ] **Step 3: Append to `src/prepare.ts`**

```ts
import archiver from "archiver";
import { basename } from "node:path";

export interface TrainingZip {
  base64: string;
  uniqueCount: number;
  totalCount: number;
}

export async function buildTrainingZip(dir: string): Promise<TrainingZip> {
  const all = readdirSync(dir).filter((f) =>
    IMAGE_EXTS.has(extname(f).toLowerCase())
  );
  const unique = await dedupeFiles(dir);

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c) => chunks.push(c));

  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  for (const path of unique) {
    const raw = readFileSync(path);
    const normalized = await normalizeImage(raw);
    archive.append(normalized, { name: basename(path).replace(/\.[^.]+$/, ".jpg") });
  }
  await archive.finalize();
  await done;

  const buf = Buffer.concat(chunks);
  return {
    base64: buf.toString("base64"),
    uniqueCount: unique.length,
    totalCount: all.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/prepare.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/prepare.ts tests/prepare.test.ts
git commit -m "feat(prepare): build base64-encoded training zip"
```

---

### Task 8: Command — `train`

**Files:**
- Create: `~/avatar/src/commands/train.ts`
- Create: `~/avatar/tests/commands/train.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/train.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
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
    vi.fn(async () =>
      new Response(JSON.stringify({ finetune_id: "ft_xyz" }), { status: 200 })
    )
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runTrain", () => {
  it("submits a finetune and writes cache file", async () => {
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir,
      cacheFile,
      outputDir: join(tmp, "out"),
    };

    const id = await runTrain(cfg);

    expect(id).toBe("ft_xyz");
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.id).toBe("ft_xyz");
    expect(cached.trigger).toBe("MAXAVATAR");
    expect(cached.status).toBe("Pending");
    expect(cached.photoCount).toBe(1); // p1 and p2 are duplicates
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/commands/train.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/train.ts`**

```ts
// src/commands/train.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import { submitFinetune } from "../bfl.js";
import { buildTrainingZip } from "../prepare.js";

export async function runTrain(cfg: Config): Promise<string> {
  console.log(`Reading photos from ${cfg.photosDir}...`);
  const zip = await buildTrainingZip(cfg.photosDir);
  console.log(`Prepared ${zip.uniqueCount} unique photos (from ${zip.totalCount}).`);

  const today = new Date().toISOString().slice(0, 10);
  const comment = `max-avatar-${today}-${zip.uniqueCount}photos`;

  console.log("Submitting finetune to BFL...");
  const id = await submitFinetune(cfg, {
    file_data: zip.base64,
    finetune_comment: comment,
    trigger_word: cfg.triggerWord,
    mode: "character",
    iterations: 300,
    captioning: true,
    priority: "quality",
    finetune_type: "full",
  });

  mkdirSync(dirname(cfg.cacheFile), { recursive: true });
  writeFileSync(
    cfg.cacheFile,
    JSON.stringify(
      {
        id,
        trigger: cfg.triggerWord,
        status: "Pending",
        createdAt: new Date().toISOString(),
        comment,
        photoCount: zip.uniqueCount,
      },
      null,
      2
    )
  );

  console.log(`\nTraining submitted. ID: ${id}`);
  console.log(`Photos: ${zip.uniqueCount} (deduped from ${zip.totalCount})`);
  console.log("Estimated cost: ~$6");
  console.log("Estimated time: 30–60 min\n");
  console.log("Run `avatar status` to check, or just run `avatar gen \"...\"`");
  console.log("when you're ready — it'll auto-check status.\n");
  console.log("Reminder: rotate your BFL API key. The one you pasted in chat is exposed.");

  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/commands/train.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/commands/train.ts tests/commands/train.test.ts
git commit -m "feat(commands): add train command"
```

---

### Task 9: Command — `status`

**Files:**
- Create: `~/avatar/src/commands/status.ts`
- Create: `~/avatar/tests/commands/status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/status.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runStatus } from "../../src/commands/status.js";

const tmp = join(tmpdir(), `avatar-status-${Date.now()}`);
const cacheFile = join(tmp, "cache", "finetune.json");

beforeEach(() => {
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(
    cacheFile,
    JSON.stringify({ id: "ft_a", trigger: "MAXAVATAR", status: "Pending" })
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runStatus", () => {
  it("prints status from BFL and updates cache when Ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "Ready" }), { status: 200 })
      )
    );

    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir: "",
    };

    const status = await runStatus(cfg);
    expect(status).toBe("Ready");
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.status).toBe("Ready");
  });

  it("throws if cache file missing", async () => {
    rmSync(cacheFile);
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir: "",
    };
    await expect(runStatus(cfg)).rejects.toThrow(/avatar train/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/commands/status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/status.ts`**

```ts
// src/commands/status.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Config } from "../config.js";
import { getResult, type FinetuneStatus } from "../bfl.js";

export async function runStatus(cfg: Config): Promise<FinetuneStatus> {
  if (!existsSync(cfg.cacheFile)) {
    throw new Error("No finetune yet. Run `avatar train` first.");
  }
  const cached = JSON.parse(readFileSync(cfg.cacheFile, "utf8"));
  const live = await getResult(cfg, cached.id);
  console.log(`Finetune ${cached.id}: ${live.status}`);
  if (cached.status !== live.status) {
    cached.status = live.status;
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }
  return live.status;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/commands/status.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/commands/status.ts tests/commands/status.test.ts
git commit -m "feat(commands): add status command"
```

---

### Task 10: Command — `gen`

**Files:**
- Create: `~/avatar/src/commands/gen.ts`
- Create: `~/avatar/tests/commands/gen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/gen.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/commands/gen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/gen.ts`**

```ts
// src/commands/gen.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import { generate, getResult } from "../bfl.js";

export interface GenOptions {
  count: number;
  aspectRatio: string;
  strength: number;
  open: boolean;
  pollIntervalMs?: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .slice(0, 60) || "untitled";
}

function tsForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

export async function runGen(
  cfg: Config,
  prompt: string,
  opts: GenOptions
): Promise<string[]> {
  if (opts.count > 4) {
    throw new Error("Max 4 images per call. Re-run for more.");
  }
  if (!existsSync(cfg.cacheFile)) {
    throw new Error("Run `avatar train` first.");
  }
  const cached = JSON.parse(readFileSync(cfg.cacheFile, "utf8"));

  if (cached.status !== "Ready") {
    const live = await getResult(cfg, cached.id);
    if (live.status !== "Ready") {
      throw new Error(
        `Avatar still training (state: ${live.status}). Try again later.`
      );
    }
    cached.status = "Ready";
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }

  if (!prompt.includes(cfg.triggerWord)) {
    console.warn(
      `Warning: prompt does not include "${cfg.triggerWord}" — output may not look like you.`
    );
  }

  mkdirSync(cfg.outputDir, { recursive: true });
  const tasks = Array.from({ length: opts.count }, () =>
    generate(
      cfg,
      {
        finetune_id: cached.id,
        finetune_strength: opts.strength,
        prompt,
        aspect_ratio: opts.aspectRatio,
        safety_tolerance: 2,
        output_format: "png",
      },
      { pollIntervalMs: opts.pollIntervalMs }
    )
  );
  const results = await Promise.all(tasks);

  const slug = slugify(prompt);
  const paths: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ts = tsForFile();
    const suffix = results.length > 1 ? `-${i + 1}` : "";
    const pngPath = join(cfg.outputDir, `${ts}-${slug}${suffix}.png`);
    const jsonPath = join(cfg.outputDir, `${ts}-${slug}${suffix}.json`);
    const imgRes = await fetch(r.imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Image download failed: ${imgRes.status}`);
    }
    writeFileSync(pngPath, Buffer.from(await imgRes.arrayBuffer()));
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          prompt,
          finetune_id: cached.id,
          finetune_strength: opts.strength,
          aspect_ratio: opts.aspectRatio,
          request_id: r.taskId,
          generated_at: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log(`Saved: ${pngPath}`);
    paths.push(pngPath);
    if (opts.open && process.platform === "darwin") {
      execFile("open", [pngPath]);
    }
  }
  return paths;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/commands/gen.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/commands/gen.ts tests/commands/gen.test.ts
git commit -m "feat(commands): add gen command with auto-status check and parallel N"
```

---

### Task 11: Command — `list`

**Files:**
- Create: `~/avatar/src/commands/list.ts`
- Create: `~/avatar/tests/commands/list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/list.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/avatar && npm test -- tests/commands/list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/list.ts`**

```ts
// src/commands/list.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";

export interface GenerationEntry {
  prompt: string;
  generated_at: string;
  pngPath: string;
}

export async function runList(
  cfg: Pick<Config, "outputDir">
): Promise<GenerationEntry[]> {
  if (!existsSync(cfg.outputDir)) return [];
  const jsons = readdirSync(cfg.outputDir).filter((f) => f.endsWith(".json"));
  const entries: GenerationEntry[] = jsons.map((f) => {
    const meta = JSON.parse(readFileSync(join(cfg.outputDir, f), "utf8"));
    return {
      prompt: meta.prompt ?? "",
      generated_at: meta.generated_at ?? "",
      pngPath: join(cfg.outputDir, f.replace(/\.json$/, ".png")),
    };
  });
  entries.sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
  for (const e of entries) {
    const truncated =
      e.prompt.length > 60 ? `${e.prompt.slice(0, 57)}...` : e.prompt;
    console.log(`${e.generated_at}  ${truncated}  ${e.pngPath}`);
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/avatar && npm test -- tests/commands/list.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd ~/avatar
git add src/commands/list.ts tests/commands/list.test.ts
git commit -m "feat(commands): add list command"
```

---

### Task 12: CLI entrypoint

**Files:**
- Create: `~/avatar/src/cli.ts`

- [ ] **Step 1: Implement `src/cli.ts`**

```ts
#!/usr/bin/env node
// src/cli.ts
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { runTrain } from "./commands/train.js";
import { runStatus } from "./commands/status.js";
import { runGen } from "./commands/gen.js";
import { runList } from "./commands/list.js";

const program = new Command();
program.name("avatar").description("BFL avatar finetune + generation");

program
  .command("train")
  .description("Submit a finetune training run from ~/Desktop/pics of me/")
  .action(async () => {
    const cfg = loadConfig();
    await runTrain(cfg);
  });

program
  .command("status")
  .description("Check current finetune status")
  .action(async () => {
    const cfg = loadConfig();
    await runStatus(cfg);
  });

program
  .command("gen <prompt>")
  .description("Generate image(s) from a prompt")
  .option("-n, --count <n>", "number of images (max 4)", (v) => parseInt(v, 10), 1)
  .option("-a, --aspect <ratio>", "aspect ratio (e.g. 1:1, 16:9)", "1:1")
  .option("-s, --strength <f>", "finetune strength", (v) => parseFloat(v), 1.2)
  .option("--no-open", "do not auto-open the image after generation")
  .action(async (prompt: string, opts: { count: number; aspect: string; strength: number; open: boolean }) => {
    const cfg = loadConfig();
    await runGen(cfg, prompt, {
      count: opts.count,
      aspectRatio: opts.aspect,
      strength: opts.strength,
      open: opts.open,
    });
  });

program
  .command("list")
  .description("List past generations")
  .action(async () => {
    const cfg = loadConfig();
    await runList(cfg);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Build and link**

Run:
```bash
cd ~/avatar
npm run build
npm link
```
Expected: `dist/cli.js` exists; `which avatar` returns a path.

- [ ] **Step 3: Smoke test help output**

Run: `avatar --help`
Expected: shows `train`, `status`, `gen`, `list`.

Run: `avatar gen --help`
Expected: shows `-n`, `-a`, `-s`, `--no-open`.

- [ ] **Step 4: Commit**

```bash
cd ~/avatar
git add src/cli.ts
git commit -m "feat(cli): wire commander entrypoint with train/status/gen/list"
```

---

### Task 13: End-to-end live verification (manual)

**Files:** none — runs against the real BFL API and writes to `cache/`, `output/`.

- [ ] **Step 1: Set up `.env`**

```bash
echo "BFL_API_KEY=<paste-current-key>" > ~/avatar/.env
chmod 600 ~/avatar/.env
```

- [ ] **Step 2: Confirm photos are in place**

Run: `ls "$HOME/Desktop/pics of me/" | wc -l`
Expected: 13 (the 12 unique + 1 dup).

- [ ] **Step 3: Submit training**

Run: `avatar train`
Expected: prints `Training submitted. ID: <id>` and writes `~/avatar/cache/finetune.json`. Note the cost confirmation in your BFL dashboard.

- [ ] **Step 4: Poll status until Ready**

Run periodically over 30–60 min:
```bash
avatar status
```
Expected: progresses `Pending` → `Ready`.

- [ ] **Step 5: Generate a test image**

Run: `avatar gen "MAXAVATAR portrait, business attire, neutral studio background, soft lighting"`
Expected: image saved to `~/avatar/output/<ts>-maxavatar-portrait-business-attire.png` and opens in Preview.

- [ ] **Step 6: Generate variations**

Run: `avatar gen -n 4 -a 16:9 "MAXAVATAR walking on Jacksonville Beach at sunset, candid"`
Expected: 4 images saved.

- [ ] **Step 7: List**

Run: `avatar list`
Expected: timestamps, prompts, paths printed newest-first.

- [ ] **Step 8: Rotate the leaked API key**

Go to https://dashboard.bfl.ai, revoke the key starting `bfl_yJUq...`, generate a new one, replace `BFL_API_KEY` in `~/avatar/.env`.

- [ ] **Step 9: Commit any final tweaks**

If you make tweaks during smoke-testing, commit them. Otherwise nothing to commit here.

---

## Self-review notes

- **Spec coverage:** Every spec section has at least one task. Ultra inference endpoint (Task 4 + 10), `MAXAVATAR` trigger (Task 1, used in 8/10), photo dedupe + 2048 resize + EXIF strip (Tasks 5/6), zip + base64 (Task 7), cache file shape (Task 8), output naming + JSON sidecar (Task 10), `--no-open` flag (Task 12), security reminder (Task 8 + Task 13 step 8).
- **No placeholders:** every code step contains real code. Where Tasks 3/4/6/7 append to existing files, the test sections specify "Append to" so the engineer doesn't overwrite.
- **Type consistency:** `Config` shape, `FinetunePayload`, `GeneratePayload`, `BflResult`, `FinetuneStatus`, and `GenerationEntry` are defined once and reused. `runTrain`, `runStatus`, `runGen`, `runList` all take a `Config`.
- **Cost guardrails:** Task 10 caps `count` at 4 to prevent accidental cost spikes.
- **Edge case I noticed during review:** `runGen` parallel loop uses `tsForFile()` which is sub-millisecond — if two parallel writes resolve in the same ms they'd clobber each other. To avoid: append `-${index}` when count > 1. Adding to gen.ts: each task gets its own index.

(I'll fix the duplicate-timestamp issue inline below before handing off.)
