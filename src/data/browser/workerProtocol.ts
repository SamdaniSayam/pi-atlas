/**
 * Stage 6: typed message protocol between the main thread and the search
 * Worker. The Worker owns the WASM engine, chunk loading and all heavy work;
 * the main thread only sends jobs and receives progress/results.
 */
import type { WebDatasetManifest } from "./manifest";
import type { ChunkCacheStatus } from "./chunkCache";

export type WorkerJobKind =
  | "exact"
  | "letters"
  | "dates"
  | "pattern"
  | "stats"
  | "window"
  | "samples";

export interface WorkerInit {
  type: "init";
  /** Verbatim pi-atlas-packed-v1 core manifest JSON for the WASM engine. */
  coreManifestJson: string;
  /** Browser-facing manifest (chunk filenames, baseUrl, datasetId). */
  webManifest: WebDatasetManifest;
  /** Module base URL used to resolve WASM/chunk assets. */
  baseUrl: string;
  /** RPC correlation id, echoed on the response. */
  requestId?: number;
}

export interface WorkerJobRequest {
  type: "job";
  id: number;
  kind: WorkerJobKind;
  payload: unknown;
  /** RPC correlation id, echoed on the response. */
  requestId?: number;
}

export type WorkerRequest =
  | WorkerInit
  | WorkerJobRequest
  | { type: "cancel"; id: number }
  | { type: "clearCache"; requestId?: number }
  | { type: "storageStatus"; requestId: number }
  | { type: "dispose" };

export type WorkerResponse =
  | { type: "ack"; requestId: number }
  | { type: "ready"; requestId?: number; totalDigits: number; chunkCount: number }
  | { type: "progress"; id: number; checked: number; total: number }
  | { type: "result"; id: number; requestId?: number; result: unknown }
  | { type: "error"; id: number; requestId?: number; error: string }
  | { type: "storageStatus"; requestId: number; status: ChunkCacheStatus }
  | { type: "fatal"; error: string };

/** Narrowing helper for the main-thread client. */
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
