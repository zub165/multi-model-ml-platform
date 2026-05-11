# Multi-model ML API platform

Monorepo for a **FastAPI** or **Django** multi-model registry (predictions, uploads, batch) plus a **React (Vite)** clinician workspace that records **labeled feedback** and can trigger **retrain** from stored outcomes. Both backends expose the **same URL paths and JSON payloads**, so `VITE_API_URL` can point at either stack (on different ports).

## Repository layout

- `backend/` — FastAPI app (`main.py`), SQLite storage (`storage.py`), training helper (`train_any_model.py`), `models/` for `.pkl` files.
- `django_backend/` — Django project `ml_platform` + app `ml_api` (ORM-backed feedback/logs, same routes as FastAPI).
- `frontend/` — React SPA; reads `VITE_API_URL` at build/dev time.
- `scripts/list_listening_ports.sh` — print listening TCP ports so you can pick **free** ports on the VPS.

## Pick free ports (GoDaddy VPS)

```bash
bash scripts/list_listening_ports.sh
```

Choose unused ports, for example:

- **FastAPI**: `8001` (`uvicorn`)
- **Django** (if you run it alongside): `8002` (`runserver` or `gunicorn`) — never reuse the FastAPI port.
- **SPA dev or preview**: `5174` / `4174` (Vite), or serve `frontend/dist` with nginx on another free port (recommended in production).

Do **not** bind two services to the same port.

## Backend developer brief

Build and run a **multi-model ML API** that:

- Hosts many `.pkl` models behind one **`POST /predict`** contract (`model_id` + feature dict).
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
uvicorn main:app --host 0.0.0.0 --port "${API_PORT:-8000}"
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
python manage.py runserver 0.0.0.0:8002
```

Environment variables (see `django_backend/.env.example`):

- `DJANGO_DB_PATH` — SQLite file for Django ORM (default: `django_backend/data/django_ml.db`; parent dir is created automatically).
- `MODEL_DIR` — `.pkl` directory (default: `django_backend/models`).
- `CORS_ORIGINS` — same semantics as the FastAPI stack.

Production example (pick a free port):

`gunicorn ml_platform.wsgi:application --bind 0.0.0.0:8002`

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
# Default in .env.example targets Django on port 8002 locally; set to your VPS URL in production.
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
2. **Settings → Secrets and variables → Actions → Variables** → add **`VITE_API_URL`** with your **public** API base (no trailing slash), e.g. `https://your-domain:8002`.  
   - If the site is served over **HTTPS**, the API should also be **HTTPS**; otherwise the browser may block requests (mixed content).  
3. **CORS**: add your Pages origin to the API, e.g. `https://<owner>.github.io` or `https://<owner>.github.io/<repo>/` in `CORS_ORIGINS` / Django `CORS_ALLOWED_ORIGINS`.
4. Push to `main`; the **Actions** tab should show **Deploy frontend to GitHub Pages**. Your site URL appears in the workflow run and under **Pages**.

Local dev stays linked to Django on **8002** via `frontend/.env.example` → copy to `.env.local`.

## Learning loop (how the frontend “teaches” the backend)

1. Clinician runs **predict** → optional row in `prediction_log`.
2. Clinician submits **feedback** with the **true** `actual_outcome` for the same feature vector → row in `feedback`.
3. After enough rows, **retrain** fits a new `RandomForest*` on labeled feedback only (same feature list as the model metadata) and overwrites the `model_id` artifact, then reloads it in memory.

This is a pragmatic feedback loop; for production you would add auth, audit trails, versioning, drift monitoring, and scheduled retrains instead of a manual button.

## Security note

`/register_model` and `/retrain` are powerful. On a public VPS, put them behind **VPN**, **mTLS**, or **authenticated admin routes** before exposing to the internet.
