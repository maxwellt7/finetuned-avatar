#!/usr/bin/env node
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
  .option("-s, --strength <f>", "LoRA scale (1.0 default; 0.8-1.0 best for portraits)", (v) => parseFloat(v), 1.0)
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
