/**
 * Central application configuration.
 * Every tunable value lives here — components must not hardcode their own copies.
 *
 * The served dataset size is NOT fixed here: it comes from the service manifest
 * at runtime (D17). `DATASET_SIZE` remains only as the fixture size the local
 * parity engines were measured against.
 */
export const APP_NAME = "π Atlas";
export const APP_TAGLINE = "An atlas of a billion digits";

/** Fixture size for the local engine parity tests — not the served dataset. */
export const DATASET_SIZE = 2_000_000;

export const DEFAULT_PIXEL_WIDTH = 48;
export const MIN_PIXEL_WIDTH = 16;
export const MAX_PIXEL_WIDTH = 96;
export const PIXEL_WIDTH_STEP = 8;

export const MAX_NUMBER_QUERY_LENGTH = 20;
export const MAX_WORD_LENGTH = 12;

export const MAX_PATTERN_ROWS = 6;
export const MAX_PATTERN_COLS = 6;
export const MIN_PATTERN_CELLS = 2;
export const MAX_COLOR_CONSTRAINED_CELLS = 8;
export const MAX_SHAPE_CONSTRAINED_CELLS = 24;

export const MAX_STORED_MATCHES = 200_000;

export const MAX_HISTORY_ENTRIES = 20;

export const STORAGE_KEY_SETTINGS = "pi-atlas:settings:v1";

/** Chi-square critical value, 9 degrees of freedom, 95th percentile. */
export const CHI_SQUARE_95_DF9 = 16.919;
