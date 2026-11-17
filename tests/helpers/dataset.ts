/** Loads the real π dataset from public/ for engine tests (runs from repo root). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const datasetPath = resolve(process.cwd(), "public/pi-2m.txt");

export const digits: string = readFileSync(datasetPath, "ascii");
