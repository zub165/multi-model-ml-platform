# Multi-model ML API platform

Monorepo for a **FastAPI** multi-model registry (predictions, uploads, batch) plus a **React (Vite)** clinician workspace that records **labeled feedback** and can trigger **retrain** from stored outcomes.

## Repository layout

- `backend/` — FastAPI app (`main.py`), SQLite storage (`storage.py`), training helper (`train_any_model.py`), `models/` for `.pkl` files.
- `frontend/` — React SPA; reads `VITE_API_URL` at build/dev time.
- `scripts/list_listening_ports.sh` — print listening TCP ports so you can pick **free** ports on the VPS.

## Pick free ports (GoDaddy VPS)

```bash
bash scripts/list_listening_ports.sh
```

Choose two unused ports, for example:

- **API**: `8001` (uvicorn)
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
# Set VITE_API_URL to http://VPS_IP:API_PORT
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

## GitHub

```bash
cd /path/to/multi-model-ml-platform
git init
git add .
git commit -m "Initial multi-model ML API and React workspace"
# Create an empty repo on GitHub, then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

## Learning loop (how the frontend “teaches” the backend)

1. Clinician runs **predict** → optional row in `prediction_log`.
2. Clinician submits **feedback** with the **true** `actual_outcome` for the same feature vector → row in `feedback`.
3. After enough rows, **retrain** fits a new `RandomForest*` on labeled feedback only (same feature list as the model metadata) and overwrites the `model_id` artifact, then reloads it in memory.

This is a pragmatic feedback loop; for production you would add auth, audit trails, versioning, drift monitoring, and scheduled retrains instead of a manual button.

## Security note

`/register_model` and `/retrain` are powerful. On a public VPS, put them behind **VPN**, **mTLS**, or **authenticated admin routes** before exposing to the internet.
