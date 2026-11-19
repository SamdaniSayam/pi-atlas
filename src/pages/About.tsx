/** About / methodology / privacy (Part A §7 item 14, §36). */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "../constants";
import { usePiStore, useDatasetSize } from "../data/piStore";
import { formatInt } from "../engine/format";

export default function About() {
  const manifest = usePiStore((s) => s.manifest);
  const digitCount = useDatasetSize();
  useEffect(() => {
    document.title = `About · ${APP_NAME}`;
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="m-0" style={{ fontSize: "clamp(28px, 4vw, 36px)" }}>About {APP_NAME}</h1>
      <p className="mt-4 text-[15px]" style={{ color: "var(--text-2)" }}>
        {APP_NAME} is an interactive atlas of the first{" "}
        <strong className="mono">{formatInt(digitCount)}</strong> decimal digits
        of π. Every search runs locally in your browser. The app loads only the
        small digit windows it needs, and no search text is ever sent anywhere.
      </p>

      <section className="panel mt-6 p-5" id="methodology" aria-labelledby="methodology-h">
        <h2 id="methodology-h" className="m-0 text-xl">Methodology</h2>

        <h3 className="mb-1 mt-4 text-base">Dataset generation & verification</h3>
        <ul className="mt-2 list-disc pl-5 text-sm" style={{ color: "var(--text-2)" }}>
          <li>
            The billion digits were computed with <span className="mono">y-cruncher</span>
            (Chudnovsky formula). The first two million decimals were additionally
            checked byte-for-byte against an independently computed reference file.
          </li>
          <li>
            The searchable dataset is packed 4 bits per digit into chunked binary
            files. The manifest records per-chunk and whole-file SHA-256 checksums
            plus known checkpoints (<span className="mono">"12"</span> at position 148,{" "}
            <span className="mono">"999999"</span> at 762); the app verifies
            every checksum at startup and refuses to load on any mismatch.
          </li>
          <li className="mono break-all" style={{ color: "var(--text-2)" }}>
            Format: {manifest?.format ?? "…"} · SHA-256 (packed):{" "}
            {manifest?.sha256Packed ?? "…"}
          </li>
          <li>
            The searchable dataset excludes the leading integer <span className="mono">3</span>:
            position 1 is the first digit after the decimal point (<span className="mono">1</span> in{" "}
            <span className="mono">3.14159…</span>).
          </li>
        </ul>

        <h3 className="mb-1 mt-4 text-base">Search engines</h3>
        <ul className="mt-2 list-disc pl-5 text-sm" style={{ color: "var(--text-2)" }}>
          <li>Number search counts overlapping occurrences with a linear scan.</li>
          <li>Letter search builds two independent pair alignments (frames A and B) and runs KMP over each; occurrences may overlap.</li>
          <li>Colour and shape searches run in a Web Worker, scanning only valid anchors so patterns never wrap across row boundaries.</li>
          <li>Pattern matching treats wildcards (<span className="mono">·</span>) as matching any digit; ink-only shape mode treats unpainted cells as wildcards.</li>
        </ul>

        <h3 className="mb-1 mt-4 text-base">The probability model</h3>
        <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>
          Every "expected" figure in this app assumes digits behave like independent
          draws from a uniform urn: a length-L sequence should appear about{" "}
          <span className="mono">(N − L + 1) / 10^L</span> times, a letter A–V has
          probability 4/100 per aligned pair (W–Z: 3/100, because pairs wrap mod 26),
          and a constrained pattern of k cells has probability{" "}
          <span className="mono">1 / base^k</span> per anchor. These are model
          estimates. Useful expectations, not proofs. π's normality remains an open
          problem in mathematics.
        </p>
      </section>

      <section className="panel mt-4 p-5" id="privacy" aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="m-0 text-xl">Privacy</h2>
        <ul className="mb-0 mt-3 list-disc pl-5 text-sm" style={{ color: "var(--text-2)" }}>
          <li>No accounts, no analytics, no cookies, no third-party requests.</li>
          <li>Searches run entirely on this device. No user data is collected, and recent results stay in a bounded in-memory cache.</li>
          <li>Search history lives in memory for the current session only.</li>
          <li>Settings are stored in your browser's localStorage under a versioned key.</li>
        </ul>
      </section>

      <section className="panel mt-4 p-5" aria-labelledby="credits-h">
        <h2 id="credits-h" className="m-0 text-xl">Credits & links</h2>
        <p className="mb-0 mt-3 text-sm" style={{ color: "var(--text-2)" }}>
          Fonts: Fraunces, Inter, JetBrains Mono (OFL, self-hosted). Built with React,
          Vite, Tailwind CSS and TypeScript. Explore{" "}
          <Link to="/explore/digits" style={{ color: "var(--accent)" }}>the digits</Link> or{" "}
          <Link to="/tour" style={{ color: "var(--accent)" }}>take the tour</Link>.
        </p>
      </section>
    </div>
  );
}
