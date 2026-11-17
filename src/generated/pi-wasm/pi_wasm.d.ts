/* tslint:disable */
/* eslint-disable */

/**
 * A checksum-verified dataset loaded into the WASM engine, chunk by chunk.
 */
export class PiEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drop all resident chunks.
     */
    clear_chunks(): void;
    /**
     * Whole-dataset digit counts + chi-square. JSON (pi-core DigitStats).
     */
    compute_stats(): string;
    /**
     * Drop a single resident chunk (memory pressure / cache eviction).
     */
    drop_chunk(index: number): void;
    /**
     * 1-based position of the first occurrence, or 0 if absent.
     */
    find_first(query: string): bigint;
    /**
     * Read a single digit by 1-based position (for evenly spread samples).
     * Only the single owning chunk needs to be resident.
     */
    get_digit(position: bigint): number;
    /**
     * ASCII digits for 1-based inclusive [start, end]. Only the chunks
     * covering the range need to be resident.
     */
    get_window(start: bigint, end: bigint): string;
    /**
     * True when chunk `index` has been verified and stored.
     */
    has_chunk(index: number): boolean;
    /**
     * Number of verified chunks currently resident.
     */
    loaded_chunks(): number;
    /**
     * Longest proper prefix of an absent query that does occur. JSON or "null".
     */
    longest_existing_prefix(query: string): string;
    /**
     * Build an empty engine from a `pi-atlas-packed-v1` **core** manifest JSON
     * string. No digit bytes are resident yet; call `set_chunk` for each chunk.
     */
    constructor(manifest_json: string);
    /**
     * Date search: encode all six formats and run exact search on each.
     * Returns JSON array of { id, label, sequence, result }.
     */
    search_dates(year: number, month: number, day: number): string;
    /**
     * Exact overlapping numeric search. Returns JSON (pi-core ExactResult).
     */
    search_exact(query: string, position_cap: number): string;
    /**
     * Letter search over both pair frames. `word` must already be normalized
     * A-Z by the caller (the app's TS normalizer); values are derived here.
     */
    search_letters(word: string, position_cap: number): string;
    /**
     * 2-D colour/shape pattern search. `spec_json`: {rows, cols, cells, colour_mode}.
     */
    search_pattern(spec_json: string, field_cols: bigint, match_cap: number): string;
    /**
     * Verify and store one packed chunk. Checks byte length and per-chunk
     * SHA-256 from the manifest before the bytes become resident. Re-loading a
     * chunk is idempotent; a corrupt chunk is rejected and not stored.
     */
    set_chunk(index: number, bytes: Uint8Array): void;
    readonly chunk_count: number;
    readonly total_digits: bigint;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_piengine_free: (a: number, b: number) => void;
    readonly piengine_chunk_count: (a: number) => number;
    readonly piengine_clear_chunks: (a: number) => void;
    readonly piengine_compute_stats: (a: number) => [number, number, number, number];
    readonly piengine_drop_chunk: (a: number, b: number) => void;
    readonly piengine_find_first: (a: number, b: number, c: number) => [bigint, number, number];
    readonly piengine_get_digit: (a: number, b: bigint) => [number, number, number];
    readonly piengine_get_window: (a: number, b: bigint, c: bigint) => [number, number, number, number];
    readonly piengine_has_chunk: (a: number, b: number) => number;
    readonly piengine_loaded_chunks: (a: number) => number;
    readonly piengine_longest_existing_prefix: (a: number, b: number, c: number) => [number, number, number, number];
    readonly piengine_new: (a: number, b: number) => [number, number, number];
    readonly piengine_search_dates: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly piengine_search_exact: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly piengine_search_letters: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly piengine_search_pattern: (a: number, b: number, c: number, d: bigint, e: number) => [number, number, number, number];
    readonly piengine_set_chunk: (a: number, b: number, c: number, d: number) => [number, number];
    readonly piengine_total_digits: (a: number) => bigint;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
