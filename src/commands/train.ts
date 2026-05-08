import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import { submitFinetune, uploadZip } from "../fal.js";
import { buildTrainingZip } from "../prepare.js";

export async function runTrain(cfg: Config): Promise<string> {
  console.log(`Reading photos from ${cfg.photosDir}...`);
  const zip = await buildTrainingZip(cfg.photosDir);
  console.log(`Prepared ${zip.uniqueCount} unique photos (from ${zip.totalCount}).`);

  const zipBytes = Buffer.from(zip.base64, "base64");
  console.log(`Uploading ${(zipBytes.length / 1024 / 1024).toFixed(1)} MB to fal.ai storage...`);
  const imagesDataUrl = await uploadZip(cfg, zipBytes);

  const today = new Date().toISOString().slice(0, 10);
  const comment = `max-avatar-${today}-${zip.uniqueCount}photos`;

  console.log("Submitting LoRA training to fal.ai...");
  const submission = await submitFinetune(cfg, {
    images_data_url: imagesDataUrl,
    trigger_phrase: cfg.triggerWord,
    create_masks: true,
    subject_crops: true,
  });

  mkdirSync(dirname(cfg.cacheFile), { recursive: true });
  writeFileSync(
    cfg.cacheFile,
    JSON.stringify(
      {
        id: submission.requestId,
        statusUrl: submission.statusUrl,
        responseUrl: submission.responseUrl,
        trigger: cfg.triggerWord,
        status: "Pending",
        createdAt: new Date().toISOString(),
        comment,
        photoCount: zip.uniqueCount,
        imagesDataUrl,
      },
      null,
      2
    )
  );

  console.log(`\nTraining submitted. Request ID: ${submission.requestId}`);
  console.log(`Photos: ${zip.uniqueCount} (deduped from ${zip.totalCount})`);
  console.log("Estimated cost: ~$2-3");
  console.log("Estimated time: ~10-15 min\n");
  console.log("Run `avatar status` to check, or just run `avatar gen \"...\"`");
  console.log("when you're ready — it'll auto-check status.\n");
  console.log("Reminder: rotate your fal.ai API key. The one you pasted in chat is exposed.");

  return submission.requestId;
}
