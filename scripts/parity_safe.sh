#!/usr/bin/env bash
# Run the 2M-digit parity test with a hard 1.5 GB memory cap, one short-lived
# process per phase, plus the full run. A future regression cannot OOM-kill the
# process (and take the parent agent app with it): the in-script RSS watchdog
# aborts at 512 MB and mismatch messages are bounded to a few hundred chars.
set -euo pipefail
cd "$(dirname "$0")/.."

RUN=()
if command -v systemd-run >/dev/null 2>&1; then
  RUN=(systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0)
else
  echo "systemd-run unavailable: relying on the in-script 512 MB RSS watchdog." >&2
fi

for phase in exact letters dates pattern stats windows; do
  echo "== parity phase: $phase =="
  PI_PARITY_PHASE="$phase" "${RUN[@]}" /usr/bin/time -f "  peak %M KB, %e s" node scripts/parity_wasm.cjs
done

echo "== parity: full run =="
"${RUN[@]}" node scripts/parity_wasm.cjs
