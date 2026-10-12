# Deploying the website (private, trusted people)

The frontend is a static website (`frontend/dist/`, built with
`VITE_API_URL=/api` via `frontend/.env.production`). One Caddy serves it
and the API from a single origin; Cloudflare Tunnel + Access put a login
in front without opening any port on this host.

## One-time setup (your checklist — dashboards I can't reach)

1. **Domain**: buy one (~$10–12/yr), add it to Cloudflare (free plan).
2. **Docker Desktop**: install, then `docker build -t data-engine .` from the
   repo root (token mode refuses to run without a working docker backend).
3. **Keys**: rotate `GEMINI_API_KEY` / `DATA_API_KEY` / `OPENWEATHER_API_KEY`
   in their consoles; keep them in this host's `.env` only.
4. **Token**: mint a long random `PF_API_TOKEN` (password manager, 32+ chars).
5. **Tunnel**: `cloudflared tunnel login`, `create transit`,
   `route dns transit transit.example.com`, copy
   `cloudflared-config.example.yml` to `~/.cloudflared/config.yml`.
6. **Access**: Zero Trust → Access → application on `transit.example.com`,
   policy = emails of your few people (OTP login, plain browser, no installs).
7. **Host stays awake**: disable sleep; outages = downtime (accepted).

## Every start (this host, two terminals or services)

```powershell
# terminal 1 — backend (token mode: auth + docker-mandatory + TTL active)
$env:PF_API_TOKEN="<paste>"
$env:SANDBOX_BACKEND="docker"
$env:SANDBOX_DOCKER_IMAGE="data-engine"
python -m uvicorn backend_api:app --host 127.0.0.1 --port 8000

# terminal 2 — edge (SITE_HOST + token come from the environment)
$env:SITE_HOST="transit.example.com"
$env:PF_API_TOKEN="<paste>"
caddy run --config deploy/Caddyfile --adapter caddyfile

# terminal 3 — tunnel
cloudflared tunnel run transit
```

Build the site first (`cd frontend; npm run build`) after any frontend
change — Caddy serves `dist/`, never the dev server.

## Why it's shaped this way

- Visitors never see a token field: Cloudflare Access is the login, Caddy
  injects `PF_API_TOKEN` server-side.
- Same origin (`/api`) means no CORS exceptions and no absolute backend
  URLs baked anywhere except local dev.
- Run URLs stay capabilities with a TTL (`ARTIFACT_TTL_S`, default 600s);
  rotate `PF_API_TOKEN` if one leaks. Shared token = shared Gemini spend.
- Not for the public internet: no per-user quotas, no sandbox host
  separation, row samples served by design. See root README threat model.
