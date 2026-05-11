# Multi-model ML API platform

Monorepo for a **FastAPI** or **Django** multi-model registry (predictions, uploads, batch) plus a **React (Vite)** clinician workspace that records **labeled feedback** and can trigger **retrain** from stored outcomes. Both backends expose the **same URL paths and JSON payloads**, so `VITE_API_URL` can point at either stack (on different ports).

## Repository layout

- `backend/` — FastAPI app (`main.py`), SQLite storage (`storage.py`), training helper (`train_any_model.py`), `models/` for `.pkl` files.
- `django_backend/` — Django project `ml_platform` + app `ml_api` (ORM-backed feedback/logs, same routes as FastAPI).
- `frontend/` — React SPA; reads `VITE_API_URL` at build/dev time.
- `scripts/list_listening_ports.sh` — print listening TCP ports so you can pick **free** ports on the VPS.

## Pick free ports (GoDaddy VPS)

On many GoDaddy VPS images, **low ports** (`80`, `443`, `3306`) and the **`8000`–`8012` range** are often already taken. This repo’s **documented VPS defaults** use higher ports that are usually free; **always verify** on your box:

```bash
bash scripts/list_listening_ports.sh
# or on the VPS:
ss -ltnp
```

Suggested defaults on the **VPS**:

- **FastAPI**: **`8890`** (`uvicorn`)
- **Django** (if you run it alongside): **`8891`** — never reuse the FastAPI port.
- **SPA dev** (usually your Mac/PC, not the VPS): **`5174`** / **`4174`** (Vite), or serve `frontend/dist` behind **nginx on 443** in production.

If **`8890` or `8891` is in use**, pick the next free port (e.g. `8892`, `8893`) and use the same value in `API_PORT`, `runserver`, `gunicorn --bind`, and `VITE_API_URL`.

Do **not** bind two services to the same port.

## SSH reverse tunnel (VPS reaches your Mac API)

Use this when the **GoDaddy VPS** (or another remote host) must call an API you run **only on your Mac** (e.g. `uvicorn` / Django on `localhost`). The SSH server on the VPS accepts connections on a **remote** port and forwards them to a port on your Mac.

1. On the **VPS**, pick a **free** listen port (example **`8892`** for the tunnel endpoint — change if `ss -ltnp` shows it busy):

   ```bash
   ss -ltnp | grep ':8892'
   ```

2. On your **Mac**, start the API on a local port (example **`8040`**, same as `scripts/macmini-setup.sh`):

   ```bash
   cd backend && source .venv/bin/activate
   uvicorn main:app --host 127.0.0.1 --port 8040
   ```

3. From the **Mac**, open the reverse tunnel (replace user/host; or use **`scripts/macmini-reverse-tunnel.sh`**):

   ```bash
   bash scripts/macmini-reverse-tunnel.sh YOUR_USER YOUR_VPS_IP 8892 8040
   ```

   Same thing manually:

   ```bash
   ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
     -R 8892:127.0.0.1:8040 username@YOUR_GODADDY_IP
   ```

   With the default OpenSSH settings, `-R 8892:…` is usually bound to **127.0.0.1 on the VPS only** (not the public internet). That is good for **curl/nginx on the same VPS** talking to `http://127.0.0.1:8892`. Changing `GatewayPorts` to expose the tunnel publicly is **risky** — avoid unless you fully understand the exposure.

4. On the **VPS**, call the API (this repo uses **`POST /predict`** with JSON, not `GET`):

   ```bash
   curl -sS http://127.0.0.1:8892/health
   curl -sS -X POST http://127.0.0.1:8892/predict \
     -H 'Content-Type: application/json' \
     -d '{"model_id":"ckd_risk","data":{"age":55,"diabetes":1,"systolic_bp":145,"creatinine":1.8,"proteinuria":2},"log_prediction":false}'
   ```

5. **Keep the tunnel up** (Mac): `autossh` reconnects if SSH drops (install with Homebrew: `brew install autossh`):

   ```bash
   autossh -M 0 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
     -N -R 8892:127.0.0.1:8040 username@YOUR_GODADDY_IP
   ```

The tunnel lasts **only while SSH stays connected**. For a durable setup, prefer **running the API on the VPS** or **systemd + autossh** on the Mac.

## Backend developer brief

Build and run a **multi-model ML API** that:

- Hosts many `.pkl` models behind one **`POST /predict`** contract (`model_id` + feature dict).
- Trains from an uploaded CSV via **`POST /train`** (multipart: `file`, `model_id`, `target_column`, `model_type`, optional `description`), then registers the new artifact.
- Exposes **`GET /models`** and **`GET /models/{model_id}`** for metadata (feature order matters).
- Supports **`POST /register_model`** (multipart upload) for new models without redeploying code paths.
- Persists **clinician feedback** via **`POST /feedback`** (features + `actual_outcome`) into SQLite.
- Retrains from accumulated labels with **`POST /retrain`** (default `min_samples=10`), then reloads the artifact for that `model_id`.
- Uses **`CORS_ORIGINS`** so only your React origin can call the browser-facing API.

### Local backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional: edit API_PORT / CORS_ORIGINS / paths
export $(grep -v '^#' .env | xargs) 2>/dev/null || true
# Place a trained ckd_model.pkl under backend/models/ or register via API
uvicorn main:app --host 0.0.0.0 --port "${API_PORT:-8890}"
```

Environment variables (see `backend/.env.example`):

- `API_PORT` — bind port for uvicorn when using `python main.py` (optional helper).
- `MODEL_DIR` — where `.pkl` files live (default: `backend/models`).
- `DB_PATH` — SQLite file (default: `backend/data/ml_platform.db`).
- `CORS_ORIGINS` — comma-separated list, must include your React URL.

### Django backend (same API contract)

Use this if you prefer **Django** (e.g. Corus-style deployments) while keeping the React client unchanged.

```bash
cd django_backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # optional: CORS_ORIGINS, MODEL_DIR, DJANGO_DB_PATH, SECRET_KEY
export $(grep -v '^#' .env | xargs) 2>/dev/null || true
python manage.py migrate
# Put trained pickles in django_backend/models/ (e.g. ckd_model.pkl) or use POST /register_model
python manage.py runserver 0.0.0.0:8891
```

Environment variables (see `django_backend/.env.example`):

- `DJANGO_DB_PATH` — SQLite file for Django ORM (default: `django_backend/data/django_ml.db`; parent dir is created automatically).
- `MODEL_DIR` — `.pkl` directory (default: `django_backend/models`).
- `CORS_ORIGINS` — same semantics as the FastAPI stack.

Production example (pick a free port):

`gunicorn ml_platform.wsgi:application --bind 0.0.0.0:8891`

### Train a new model from CSV

```bash
cd backend
source .venv/bin/activate
python train_any_model.py --data your.csv --target label_col --type classification --name diabetes_model
```

Then upload `diabetes_model.pkl` with `/register_model` or copy it into `MODEL_DIR` and extend startup registration as needed.

## Frontend (React)

The template is pinned to **Vite 5** so it builds cleanly on common Node 20 LTS images (upgrade to Node **20.19+** if you later move to Vite 8).

```bash
cd frontend
cp .env.example .env.local
# .env.example uses FastAPI default port 8890 locally; set to your VPS URL in production.
npm install
VITE_DEV_PORT=5174 npm run dev
```

Production build + static preview (separate port from API):

```bash
cd frontend
npm run build
VITE_PREVIEW_PORT=4174 npm run preview
```

For production on the VPS, prefer **nginx** (or Caddy) to serve `frontend/dist` on one port and **proxy** `/predict` etc. to uvicorn, or keep split origins and tighten `CORS_ORIGINS`.

## GitHub (code + Pages for the React app)

### Push this repository

```bash
cd /path/to/multi-model-ml-platform
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

### Deploy the frontend to GitHub Pages

Workflow: `.github/workflows/deploy-frontend-pages.yml` (runs on pushes to `main` / `master` that touch `frontend/`).

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** → add **`VITE_API_URL`** with your **public** API base (no trailing slash), e.g. `https://your-domain:8890`.  
   - If the site is served over **HTTPS**, the API should also be **HTTPS**; otherwise the browser may block requests (mixed content).  
3. **CORS**: add your Pages origin to the API, e.g. `https://<owner>.github.io` or `https://<owner>.github.io/<repo>/` in `CORS_ORIGINS` / Django `CORS_ALLOWED_ORIGINS`.
4. Push to `main`; the **Actions** tab should show **Deploy frontend to GitHub Pages**. Your site URL appears in the workflow run and under **Pages**.

Local dev uses **`frontend/.env.example`** (FastAPI on **8890** by default) → copy to `.env.local` and change if your API port differs.

**GitHub Pages:** if you did not bake `VITE_API_URL` at build time, the SPA can still prompt for an API URL; it saves **`ML_API_BASE_URL`** in the browser’s `localStorage` (HTTPS API recommended when the site is HTTPS).

## Settings (all in one place)

Copy the example env files, then edit:

| File | Command |
|------|---------|
| FastAPI | `cp backend/.env.example backend/.env` |
| Django | `cp django_backend/.env.example django_backend/.env` |
| React (local) | `cp frontend/.env.example frontend/.env.local` |

Load into your shell on Linux/VPS (optional):

```bash
set -a && source backend/.env && set +a   # from repo root, path as needed
```

### FastAPI (`backend/.env`)

| Variable | Purpose | Example |
|----------|---------|---------|
| `API_PORT` | Port `uvicorn` / `python main.py` listens on | `8890` |
| `DB_PATH` | SQLite file for prediction log + feedback | *(default under `backend/data/`)* |
| `MODEL_DIR` | Directory for `.pkl` files | *(default `backend/models`)* |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API | `http://127.0.0.1:5174,https://zub165.github.io` |

### Django (`django_backend/.env`)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DJANGO_SECRET_KEY` | Django secret | long random string in production |
| `DJANGO_DEBUG` | `1` dev, `0` production | `0` on VPS public |
| `ALLOWED_HOSTS` | Comma hostnames | `yourdomain.com,www.yourdomain.com` |
| `DJANGO_DB_PATH` | SQLite path for ORM | *(optional; default `django_backend/data/`)* |
| `MODEL_DIR` | `.pkl` directory | *(default `django_backend/models`)* |
| `CORS_ORIGINS` | Same idea as FastAPI | match your React / GitHub Pages origin |

Run Django on a **different port** than FastAPI, e.g. **`8891`**:  
`python manage.py runserver 0.0.0.0:8891`

### React (`frontend/.env.local` + browser)

| Variable / key | Purpose | Example |
|----------------|---------|---------|
| `VITE_API_URL` | API base URL (no trailing slash), baked in at **build** time | `http://127.0.0.1:8890` or `https://api.yourdomain.com:8890` |
| `VITE_DEV_PORT` | Local Vite dev port | `5174` |
| `VITE_PREVIEW_PORT` | `vite preview` port | `4174` |
| `VITE_BASE_PATH` | Subpath for GitHub Pages (usually set by CI only) | `/multi-model-ml-platform/` |
| `localStorage` **`ML_API_BASE_URL`** | Set from the SPA “Connect” screen (GitHub Pages) without rebuilding | same as `VITE_API_URL` |

### GitHub Actions (repository **Variables**)

| Name | Purpose |
|------|---------|
| `VITE_API_URL` | Public API URL for the Pages build (HTTPS if the site is HTTPS) |

### Mac mini scripts (environment or arguments)

| Script | Variables / args |
|--------|-------------------|
| `scripts/macmini-setup.sh` | `API_PORT` (default `8040`), `FE_PORT` (default `5174`) |
| `scripts/macmini-reverse-tunnel.sh` | Positional: `user host [remote_port] [local_port]` **or** `VPS_USER`, `VPS_HOST`, `REMOTE_PORT` (default `8892`), `LOCAL_PORT` (default `8040`) |

### VPS firewall (if `ufw` is enabled)

```bash
sudo ufw allow 8890/tcp comment 'FastAPI ML API'
sudo ufw allow 8891/tcp comment 'Django ML API'
sudo ufw status
```

Replace ports if you changed them. **SSH (22)** must stay allowed for tunnels.

## Learning loop (how the frontend “teaches” the backend)

1. Clinician runs **predict** → optional row in `prediction_log`.
2. Clinician submits **feedback** with the **true** `actual_outcome` for the same feature vector → row in `feedback`.
3. After enough rows, **retrain** fits a new `RandomForest*` on labeled feedback only (same feature list as the model metadata) and overwrites the `model_id` artifact, then reloads it in memory.

This is a pragmatic feedback loop; for production you would add auth, audit trails, versioning, drift monitoring, and scheduled retrains instead of a manual button.

## Security note

`/register_model` and `/retrain` are powerful. On a public VPS, put them behind **VPN**, **mTLS**, or **authenticated admin routes** before exposing to the internet.
