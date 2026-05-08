import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

export interface Config {
  apiKey: string;
  queueBase: string;
  storageBase: string;
  triggerWord: string;
  photosDir: string;
  cacheFile: string;
  outputDir: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_API_KEY is not set. Add it to ~/avatar/.env (chmod 600)."
    );
  }
  return {
    apiKey,
    queueBase: "https://queue.fal.run",
    storageBase: "https://rest.alpha.fal.ai",
    triggerWord: "MAXAVATAR",
    photosDir:
      process.env.PHOTOS_DIR ?? "/Users/maxmayes/Desktop/pics of me",
    cacheFile: join(projectRoot, "cache", "finetune.json"),
    outputDir: join(projectRoot, "output"),
  };
}
