/**
 * Read decimal digits from packed chunk bytes (Stage 2 prototype).
 *
 * Mirrors `pi-core::pack` semantics exactly: two digits per byte, big nibble =
 * the even 0-based digit index within the chunk. Offsets here are relative to
 * the chunk's own digit stream (0-based), not global positions.
 */

/** Single digit value (0-9) at a 0-based offset within a packed chunk. */
export function digitAt(chunk: Uint8Array, digitOffset: number): number {
  const byte = chunk[digitOffset >> 1];
  return (digitOffset & 1) === 0 ? byte >> 4 : byte & 0x0f;
}

/** Unpack `count` digits starting at 0-based `offset` into an ASCII string. */
export function unpackRange(chunk: Uint8Array, offset: number, count: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) out += String(digitAt(chunk, offset + i));
  return out;
}

/** Pack an ASCII digit string into bytes (test/prototype helper). */
export function packDigits(ascii: string): Uint8Array {
  if (ascii.length % 2 !== 0) throw new Error("packDigits needs an even digit count");
  const out = new Uint8Array(ascii.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (Number(ascii[2 * i]) << 4) | Number(ascii[2 * i + 1]);
  }
  return out;
}
