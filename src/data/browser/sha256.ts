/**
 * SHA-256 helpers for chunk integrity verification (Stage 2 prototype).
 *
 * The default implementation uses WebCrypto (`crypto.subtle.digest`), which is
 * available on GitHub Pages HTTPS origins in all target browsers. A `Sha256`
 * function is injected into the chunk loader so tests (and exotic runtimes) can
 * supply an equivalent implementation without changing the loader.
 */

export type Sha256 = (bytes: ArrayBuffer | Uint8Array) => Promise<string>;

/** WebCrypto SHA-256 → lowercase hex. */
export const webCryptoSha256: Sha256 = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto SHA-256 is unavailable (requires a secure context)");
  const buffer: ArrayBuffer =
    bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      : bytes;
  const digest = await subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(digest));
};

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Constant-length string compare — avoids trivial timing leaks on checksum compares. */
export function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
