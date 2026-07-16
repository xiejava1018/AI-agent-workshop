/**
 * lib/models-config.ts
 *
 * Shared read/write access to the file-based model configuration
 * (`<agentDir>/models.json`). Extracted from `/api/models-config` so the
 * admin models endpoint (T4.4) can reuse the exact same source of truth for
 * the model list, defaults, and fallback order without duplicating the
 * file-path / JSON-parse logic.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ModelsConfig = Record<string, unknown> & {
  providers?: Record<string, unknown>;
  /** Default model ref, e.g. `provider/modelId`. Shape owned by the SDK. */
  defaultModel?: unknown;
  /** Ordered provider/model fallback chain. Shape owned by the SDK. */
  fallbackOrder?: unknown;
};

/** Absolute path to the file-based models config. */
export function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

/**
 * Read the models config from disk. Returns an empty `{ providers: {} }`
 * shell when the file is absent or unparseable so callers always get a
 * well-formed object.
 */
export function readModelsConfig(): ModelsConfig {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ModelsConfig;
  } catch {
    return { providers: {} };
  }
}

/** Persist the models config to disk, creating the parent dir as needed. */
export function writeModelsConfig(data: ModelsConfig): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}
