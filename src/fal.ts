import type { Config } from "./config.js";

const TRAINER_PATH = "/fal-ai/flux-lora-portrait-trainer";
const INFERENCE_PATH = "/fal-ai/flux-lora";

async function falPost(
  cfg: Pick<Config, "apiKey" | "queueBase">,
  path: string,
  body: unknown
): Promise<Response> {
  const res = await fetch(`${cfg.queueBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("fal.ai auth failed — check your API key.");
  }
  if (res.status === 429) {
    throw new Error("fal.ai rate-limited (likely a billing issue).");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fal.ai ${path} returned ${res.status}: ${t}`);
  }
  return res;
}

async function falGet(
  cfg: Pick<Config, "apiKey">,
  url: string
): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Key ${cfg.apiKey}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fal.ai GET ${url} returned ${res.status}: ${t}`);
  }
  return res;
}

export async function uploadZip(
  cfg: Pick<Config, "apiKey" | "storageBase">,
  zipBytes: Buffer,
  fileName = "training.zip"
): Promise<string> {
  const initRes = await fetch(`${cfg.storageBase}/storage/upload/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      file_name: fileName,
      content_type: "application/zip",
    }),
  });
  if (!initRes.ok) {
    throw new Error(`Storage initiate failed: ${initRes.status}`);
  }
  const { upload_url, file_url } = (await initRes.json()) as {
    upload_url: string;
    file_url: string;
  };
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: new Uint8Array(zipBytes),
  });
  if (!putRes.ok) {
    throw new Error(`Storage PUT failed: ${putRes.status}`);
  }
  return file_url;
}

export interface FinetunePayload {
  images_data_url: string;
  trigger_phrase: string;
  steps?: number;
  learning_rate?: number;
  create_masks?: boolean;
  subject_crops?: boolean;
}

export interface FinetuneSubmission {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

export async function submitFinetune(
  cfg: Pick<Config, "apiKey" | "queueBase">,
  payload: FinetunePayload
): Promise<FinetuneSubmission> {
  const res = await falPost(cfg, TRAINER_PATH, payload);
  const body = (await res.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };
  return {
    requestId: body.request_id,
    statusUrl: body.status_url,
    responseUrl: body.response_url,
  };
}

export type RequestStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface RequestStatusResponse {
  status: RequestStatus;
  queue_position?: number;
  logs?: unknown;
}

export async function getRequestStatus(
  cfg: Pick<Config, "apiKey">,
  statusUrl: string
): Promise<RequestStatusResponse> {
  const res = await falGet(cfg, statusUrl);
  return (await res.json()) as RequestStatusResponse;
}

export interface TrainResult {
  diffusers_lora_file: { url: string };
  config_file?: { url: string };
}

export async function getTrainResult(
  cfg: Pick<Config, "apiKey">,
  responseUrl: string
): Promise<TrainResult> {
  const res = await falGet(cfg, responseUrl);
  return (await res.json()) as TrainResult;
}

export interface GeneratePayload {
  prompt: string;
  loras: { path: string; scale: number }[];
  image_size?:
    | "square_hd"
    | "square"
    | "portrait_4_3"
    | "portrait_16_9"
    | "landscape_4_3"
    | "landscape_16_9";
  num_inference_steps?: number;
  guidance_scale?: number;
  num_images?: number;
  enable_safety_checker?: boolean;
  output_format?: "jpeg" | "png";
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
  cfg: Pick<Config, "apiKey" | "queueBase">,
  payload: GeneratePayload,
  opts: GenerateOptions = {}
): Promise<GenerateResult[]> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 80;

  const submitRes = await falPost(cfg, INFERENCE_PATH, payload);
  const submitBody = (await submitRes.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getRequestStatus(cfg, submitBody.status_url);
    if (status.status === "COMPLETED") {
      const finalRes = await falGet(cfg, submitBody.response_url);
      const final = (await finalRes.json()) as {
        images: { url: string; content_type?: string }[];
      };
      return final.images.map((img) => ({
        imageUrl: img.url,
        taskId: submitBody.request_id,
      }));
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      throw new Error(`Generation ${status.status.toLowerCase()}.`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    "Generation timed out — check `avatar list` later or retry."
  );
}
