# π Atlas — production deployment guide

This document is the runbook for taking π Atlas from local development to a
public site. The frontend is fully automated; the backend needs **your** cloud
account and DNS, which cannot be created from this environment.

## Architecture

```
Browser (GitHub Pages, https://<user>.github.io/pi-atlas/)
   │  fetch https://<api-host>/api/v1/...   (CORS allowlist)
   ▼
Caddy (:443, automatic Let's Encrypt TLS)
   │  reverse_proxy 127.0.0.1:7787
   ▼
pi-server (Rust, loopback only)  ──reads──▶  /srv/pi-atlas/data-1b/  (packed digits, outside Git)
```

- **Frontend**: static Vite/React build with HashRouter (no server rewrites
  needed), relative asset paths (`base: "./"`) for the `/pi-atlas/` subpath.
- **Backend**: the same Rust service used locally. It owns the packed dataset,
  verifies SHA-256 checksums at startup, runs searches as bounded async jobs,
  streams digit windows from disk, and serves `/api/v1/health`.
- **Dataset**: never in Git, never in the browser. CI regenerates only the
  2 MB test fixture pack from `public/pi-2m.txt` for E2E.

## What is already automated

`main` pushes (and manual dispatch) run `.github/workflows/deploy.yml`:
`npm ci` → typecheck → 80 unit tests → pack the 2M fixture → Rust release
build → frontend build (with `VITE_PI_ATLAS_API` from the repo Variable
`PI_ATLAS_API_URL`) → Playwright E2E against the real service on ports
4175/7788 → assert no localhost in `dist/` → deploy to Pages.

## Manual steps (require your account / credentials)

The repository `SamdaniSayam/pi-atlas` and GitHub Pages are **already created and
enabled**; the remaining manual work is the backend host (steps 1–5) and the
final verification (step 6).

### 0. Names you must choose

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `<user>` | GitHub account | `SamdaniSayam` |
| `<repo>` | Repository (already created) | `pi-atlas` |
| `<api-host>` | Public DNS name for the API | `pi-atlas.example.com` |
| `<pages-origin>` | GitHub Pages origin (no path) | `https://SamdaniSayam.github.io` |

### 1. Host for the API

Recommended, in order:

| Provider | Spec | Cost | Why |
| --- | --- | --- | --- |
| Oracle Cloud — Ampere A1 | 1 OCPU / 6 GB RAM (Always Free tier) | €0 | Generous free tier, static IP, ARM64 works fine with the Rust binary/Docker. |
| Hetzner CX22 | 2 vCPU / 4 GB / 40 GB SSD | ~€4/mo | Simplest UX, predictable billing, IPv4 included. |
| Any VPS with a public IPv4 | ≥1 vCPU, 2 GB RAM | ~€5/mo | The service streams data (~3 MB RSS at 1B digits). |

**Sizing rationale**: the 1B pack is ~477 MB on disk (4 bits/digit + chunk
indexes). Measured service RSS at 1B digits is ~3 MB because digits are memory-
mapped/streamed; VSZ is ~1.3 GB of address space, not resident memory. Budget
**10–20 GB disk** (pack + OS + logs + headroom), **2 GB RAM**, and roughly
**0.1–1 Mbps sustained egress** per active search (each digit window is a few
KB; a full result is tens of KB). Set `PI_ATLAS_MAX_CONCURRENT=4` to bound CPU
and memory under concurrent load; raise only after observing real traffic.

### 2. Get the packed dataset onto the server

Option A — copy the already-packed 1B dataset from your local machine (keeps
all checksums; ~477 MB):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pi-atlas-deploy        # if needed
ssh-copy-id -i ~/.ssh/pi-atlas-deploy.pub ubuntu@<server-ip>
ssh ubuntu@<server-ip> 'sudo mkdir -p /srv/pi-atlas && sudo chown $USER:$USER /srv/pi-atlas'
scp -r /home/megalith/pi-atlas-build/data-1b ubuntu@<server-ip>:/srv/pi-atlas/
ssh ubuntu@<server-ip> 'ls -l /srv/pi-atlas/data-1b/manifest.json'
```

Option B — generate from scratch (needs ~1.6 GB source text):

```bash
# On a beefy machine: compute the first 1,000,000,000 decimals with y-cruncher
# (Chudnovsky). Point pack_dataset.py at the ASCII decimal file.
python3 scripts/pack_dataset.py --input /path/to/pi-decimals.txt --output-dir /srv/pi-atlas/data-1b
# The script verifies every chunk SHA-256, the whole-file checksum and
# spot-unpacks digits at both ends and the middle before it succeeds.
```

Verify integrity after transfer (on the server):

```bash
python3 - <<'PY'
import json, hashlib, pathlib
d = pathlib.Path('/srv/pi-atlas/data-1b')
m = json.loads((d/'manifest.json').read_text())
h = hashlib.sha256()
for i in range(len(m['chunks'])):
    h.update((d/'chunks'/f'chunk_{i:05d}.bin').read_bytes())
assert h.hexdigest() == m['sha256_packed'], 'DATASET CORRUPTED'
print('pack verified:', m['total_digits'], 'digits')
PY
```

### 3. Install and run the service

Native binary (simplest on a small VPS):

```bash
sudo apt update && sudo apt install -y curl ca-certificates
# Build locally (Rust 1.98+), then upload:
cd service && cargo build --release --locked -p pi-server
scp service/target/release/pi-server <user>@<server-ip>:/tmp/pi-server
ssh ubuntu@<server-ip> 'sudo install -m 0755 /tmp/pi-server /usr/local/bin/pi-server'
sudo useradd --system --no-create-home --shell /usr/sbin/nologin piatlas
sudo chown -R piatlas:piatlas /srv/pi-atlas
```

Or Docker (from `service/`): `docker build -t pi-atlas-server .` then
`docker run -d --name pi-atlas -p 127.0.0.1:7787:7787 -v /srv/pi-atlas/data-1b:/data/pi-atlas-1b:ro -e PI_ATLAS_CORS_ORIGINS=<pages-origin> pi-atlas-server`.

Install the provided systemd unit:

```bash
sudo cp service/pi-atlas.service /etc/systemd/system/pi-atlas.service
# Edit PI_ATLAS_CORS_ORIGINS to <pages-origin> (exact origin, no trailing slash/path)
sudo systemctl daemon-reload
sudo systemctl enable --now pi-atlas
sudo journalctl -u pi-atlas -f        # expect "dataset ready: 1000000000 digits"
curl http://127.0.0.1:7787/api/v1/health
```

The unit binds to loopback, runs as an unprivileged user with a read-only
system filesystem, caps memory at 1 GB, and stops gracefully on SIGTERM.

### 4. HTTPS with Caddy

Point `<api-host>` DNS at the server IP, then:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo cp service/Caddyfile /etc/caddy/Caddyfile
sudo sed -i "s/pi-atlas.example.com/<api-host>/" /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -I https://<api-host>/api/v1/health   # expect 200 + valid certificate
```

Caddy obtains/renews the Let's Encrypt certificate automatically. Only
`/api/*` is proxied; no database or development port is exposed.

### 5. Connect Pages to the API

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables
→ New repository variable**:

- Name: `PI_ATLAS_API_URL`
- Value: `https://<api-host>/api/v1`

Then re-run the workflow (Actions → "Verify and deploy frontend" → Run
workflow). The CORS allowlist on the service must contain `<pages-origin>`:

```bash
sudo sed -i "s|PI_ATLAS_CORS_ORIGINS=.*|PI_ATLAS_CORS_ORIGINS=<pages-origin>|" /etc/systemd/system/pi-atlas.service
sudo systemctl daemon-reload && sudo systemctl restart pi-atlas
```

### 6. Production verification checklist

- [ ] `https://samdanisayam.github.io/pi-atlas/` opens; assets 200; no localhost in bundle.
- [ ] Routes load/refresh via `#/…`; mobile bottom nav works at 320/375/390/430 px; desktop intact.
- [ ] `curl https://<api-host>/api/v1/health` → 200 with `total_digits: 1000000000`.
- [ ] Browser: a real numeric search returns matches from the 1B dataset; letter/date/colour/shape explorers work.
- [ ] Loading, empty, error and cancel states work (also with the API stopped).
- [ ] No secrets in browser devtools; no major console errors.
- [ ] `sudo journalctl -u pi-atlas -f` shows no errors under load.

## Limits and honest notes

- **og:image**: GitHub Pages has no server-side injection, so the committed
  `og:image` is relative (`og.png`). Most browsers resolve it, but some social
  crawlers require an absolute URL. If previews matter, set a custom domain and
  change `index.html` to `content="https://<your-domain>/og.png"`.
- **Backend is not deployed here**: no cloud account/CLI/credentials exist in
  this environment, so no production API URL can be claimed until you complete
  steps 1–5. Until `PI_ATLAS_API_URL` is set, Pages serves the UI but searches
  fail gracefully (API-down state) — that is expected, not a mock.
- **1B dataset in Git**: deliberately excluded (~477 MB). CI never needs it.
- No external monitoring/alerting is configured; add UptimeRobot or similar
  against `/api/v1/health` if you need uptime notifications.
