/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_piengine_free: (a: number, b: number) => void;
export const piengine_chunk_count: (a: number) => number;
export const piengine_clear_chunks: (a: number) => void;
export const piengine_compute_stats: (a: number) => [number, number, number, number];
export const piengine_drop_chunk: (a: number, b: number) => void;
export const piengine_find_first: (a: number, b: number, c: number) => [bigint, number, number];
export const piengine_get_digit: (a: number, b: bigint) => [number, number, number];
export const piengine_get_window: (a: number, b: bigint, c: bigint) => [number, number, number, number];
export const piengine_has_chunk: (a: number, b: number) => number;
export const piengine_loaded_chunks: (a: number) => number;
export const piengine_longest_existing_prefix: (a: number, b: number, c: number) => [number, number, number, number];
export const piengine_new: (a: number, b: number) => [number, number, number];
export const piengine_search_dates: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const piengine_search_exact: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const piengine_search_letters: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const piengine_search_pattern: (a: number, b: number, c: number, d: bigint, e: number) => [number, number, number, number];
export const piengine_set_chunk: (a: number, b: number, c: number, d: number) => [number, number];
export const piengine_total_digits: (a: number) => bigint;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_start: () => void;
