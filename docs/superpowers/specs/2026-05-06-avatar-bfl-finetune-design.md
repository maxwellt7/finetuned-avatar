# Avatar — BFL Finetune CLI

**Date:** 2026-05-06
**Owner:** Max
**Status:** Approved (pending implementation plan)

## Goal

Train a personal avatar finetune on Black Forest Labs (BFL) using ~12 curated photos of Max, then generate realistic images of him from text prompts via a local CLI.

## Non-goals

- Web UI, gallery, or browser frontend
- Multi-user / multi-avatar support
- Training other people's avatars in the same project
- Editing or upscaling pipelines beyond what BFL returns
- Integration with the CMD monorepo (may happen later, separately)

## Inputs

| Item | Value |
|---|---|
| Source photos | `~/Desktop/pics of me/` — 13 files, 12 unique after dedupe |
| BFL API key | `BFL_API_KEY` in `~/avatar/.env` (chmod 600) |
| Trigger word | `MAXAVATAR` |
| Finetune mode | `character` |
| Finetune type | `full` (Pro Finetune) |
| Iterations | `300` |
| Captioning | auto (`captioning: true`) |
| Priority | `quality` |
| Inference endpoint | `flux-pro-1.1-ultra-finetuned` (Ultra) |
| Default finetune_strength | `1.2` |

## Architecture

### Project layout

```
~/avatar/
├── .env                  # BFL_API_KEY (gitignored, chmod 600)
├── .gitignore            # ignores .env, cache/, output/, dist/, node_modules/
├── package.json          # bin: { "avatar": "./dist/cli.js" }
├── tsconfig.json
├── src/
│   ├── cli.ts            # commander entrypoint, dispatches to commands
│   ├── commands/
│   │   ├── train.ts      # uploads photos, kicks off finetune, exits
│   │   ├── status.ts     # prints current finetune state
│   │   ├── gen.ts        # generates images from prompt
│   │   └── list.ts       # lists past generations from output/
│   ├── bfl.ts            # thin BFL HTTP client (fetch wrapper)
│   ├── prepare.ts        # dedupe, resize, EXIF strip, zip, base64
│   └── config.ts         # env loading, paths, constants
├── docs/superpowers/specs/2026-05-06-avatar-bfl-finetune-design.md
├── cache/
│   └── finetune.json     # { id, trigger, status, createdAt, comment }
└── output/
    ├── 2026-05-06T22-15-30-tuxedo-rooftop.png
    └── 2026-05-06T22-15-30-tuxedo-rooftop.json   # full request payload + finetune_id
```

### Stack

- Node 22, TypeScript, ESM
- `commander` for argv parsing
- Native `fetch` — no HTTP library needed
- `archiver` (or `jszip`) to build the training zip in memory
- `sharp` for resize + EXIF strip
- `dotenv` for `.env` loading
- No web framework, no React, no DB

### Modules and responsibilities

- **`config.ts`** — loads `.env`, exposes `BFL_API_KEY`, paths (`PHOTOS_DIR`, `CACHE_FILE`, `OUTPUT_DIR`), constants (`TRIGGER_WORD`, default request payloads). One source of truth so commands don't reach into `process.env` directly.
- **`bfl.ts`** — exposes typed functions: `submitFinetune(payload)`, `getResult(id)`, `generate(payload)`. Handles auth header (`x-key`), JSON encoding, and base error handling (4xx → typed error, 5xx → retry once with backoff). Knows nothing about files or the CLI.
- **`prepare.ts`** — given a directory, returns a base64-encoded zip ready for BFL: dedupes by SHA1, resizes long-edge to 2048, strips EXIF, builds zip in memory. Pure function of inputs → string. Easily unit-testable.
- **`commands/*.ts`** — orchestrate. Each command is one async function. They read config, call `bfl.ts`, format output for the terminal, write to cache/output. They contain no API knowledge beyond what's in `bfl.ts`.
- **`cli.ts`** — wires commander to commands. Should be small (~30 lines).

This split keeps the API client testable without files, the file prep testable without HTTP, and the CLI orchestration thin.

## Command flows

### `avatar train`

1. Read photos from `~/Desktop/pics of me/`. Reject if folder is empty or missing.
2. Dedupe by SHA1 (`98CBFB9A...JPG` and `98CBFB9A... 2.JPG` collapse).
3. For each photo: resize long-edge to 2048 if larger, strip EXIF, re-encode JPEG quality 92.
4. Build zip in memory. Base64-encode it.
5. POST `https://api.us1.bfl.ai/v1/finetune` with:
   ```json
   {
     "file_data": "<base64 zip>",
     "finetune_comment": "max-avatar-2026-05-06-12photos",
     "trigger_word": "MAXAVATAR",
     "mode": "character",
     "iterations": 300,
     "captioning": true,
     "priority": "quality",
     "finetune_type": "full"
   }
   ```
6. On 200, write `cache/finetune.json`:
   ```json
   {
     "id": "<finetune_id>",
     "trigger": "MAXAVATAR",
     "status": "Pending",
     "createdAt": "2026-05-06T22:15:30Z",
     "comment": "max-avatar-2026-05-06-12photos",
     "photoCount": 12
   }
   ```
7. Print:
   ```
   Training submitted. ID: <id>
   Photos: 12 (deduped from 13)
   Estimated cost: ~$6
   Estimated time: 30–60 min

   Run `avatar status` to check, or just run `avatar gen "..."` when you're ready —
   it'll auto-check status and tell you if it's not done yet.

   Reminder: rotate your BFL API key. The one you pasted in chat is exposed.
   ```

### `avatar status`

1. Read `cache/finetune.json`. If missing → "No finetune yet. Run `avatar train`."
2. Hit `GET /v1/get_result?id=<finetune_id>`.
3. Print state. If state moved to `Ready`, update cache file.

### `avatar gen "<prompt>" [-n N] [--aspect A:B] [--strength F]`

1. Load `cache/finetune.json`. If missing → "Run `avatar train` first."
2. If cached status ≠ `Ready`, call `getResult` once to refresh. If still not Ready → print state + exit non-zero with "Avatar still training. Try again later or run `avatar status`."
3. Validate the prompt contains `MAXAVATAR` (warn but don't block — user may want a non-avatar generation).
4. POST `https://api.us1.bfl.ai/v1/flux-pro-1.1-ultra-finetuned`:
   ```json
   {
     "finetune_id": "<id>",
     "finetune_strength": 1.2,
     "prompt": "<user prompt>",
     "aspect_ratio": "1:1",         // valid: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 9:21
     "safety_tolerance": 2,
     "output_format": "png"
   }
   ```
5. The response includes a polling URL (`polling_url`). Poll every 1.5s, max 80 attempts (~2 min total), until `status: Ready`. If the limit hits, exit 1 with "Generation timed out — check `avatar list` later or retry."
6. Download the signed image URL from `result.sample`.
7. Save to `output/<ISO>-<slug>.png`. Slug is first 5 words of the prompt, kebab-cased.
8. Write sibling `output/<ISO>-<slug>.json` with `{ prompt, finetune_id, finetune_strength, aspect_ratio, request_id, generated_at }`.
9. `open <path>` to launch in Preview (macOS).
10. If `-n N` (max 4), repeat N times in parallel (Promise.all), printing each path on completion. N>4 is rejected with a clear error to avoid accidental cost spikes.

### `avatar list`

1. Scan `output/`, parse the sibling `.json` files.
2. Print a table: timestamp · prompt (truncated) · file path.

## Error handling

| Case | Behavior |
|---|---|
| Missing `BFL_API_KEY` | Exit 1 with: "Set BFL_API_KEY in ~/avatar/.env" |
| `~/Desktop/pics of me/` missing or empty | Exit 1 with explicit path expected |
| BFL 401/403 | Exit 1, print "BFL auth failed — check the API key" |
| BFL 429 | Exit 1, print "Rate-limited (likely billing). Don't retry." |
| BFL 5xx | Retry once after 2s backoff, then exit 1 |
| Generation moderated | Print BFL's `Content Moderated` message + a hint to rephrase |
| Network failure mid-poll | Retry up to 3 times with exponential backoff (2s, 4s, 8s), then fail |
| `gen` called before train | Exit 1 with "Run `avatar train` first" |

## Security

- `.env` is `chmod 600` and in `.gitignore`
- The BFL key the user pasted in chat is considered compromised; train-success message reminds them to rotate
- No telemetry, no remote logging
- `cache/` and `output/` are gitignored — generated images and finetune IDs stay local
- `safety_tolerance: 2` is BFL's default — neither maximally permissive nor restrictive
- API base hardcoded to `api.us1.bfl.ai` (no user-supplied URL ever, prevents accidental key exfil to wrong host)

## Cost expectations

- Train: ~$6 (Pro Finetune full)
- Generation: ~$0.06/image (Ultra finetuned)
- This spec assumes ad-hoc usage (~10s of images), not bulk

## Open questions / future

- Whether to also generate a 2nd LoRA finetune for cheaper `flux-dev-finetuned` generations — defer until Max actually wants cheaper inference
- Aspect ratio presets — currently CLI flags only; could add a config file later if defaults shift
- CMD integration — out of scope here, but `avatar gen` is callable from any process so wiring it in later is trivial
