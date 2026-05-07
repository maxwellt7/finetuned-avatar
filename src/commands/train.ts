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
