"""
Multi-model ML API: registry, predictions, feedback storage, and optional retrain from labels.
Run from backend dir: uvicorn main:app --host 0.0.0.0 --port $API_PORT (default 8890 on VPS)
"""

from __future__ import annotations

import io
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from storage import Storage
from train_any_model import make_rf_classifier, make_rf_regressor, train_model_from_dataframe


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


MODEL_DIR = Path(os.environ.get("MODEL_DIR", str(Path(__file__).resolve().parent / "models"))).resolve()
DB_PATH = Path(os.environ.get("DB_PATH", str(Path(__file__).resolve().parent / "data" / "ml_platform.db"))).resolve()
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
    if o.strip()
]


class ModelRegistry:
    def __init__(self) -> None:
        self.models: Dict[str, Any] = {}
        self.model_info: Dict[str, Dict[str, Any]] = {}

    def register_model(
        self,
        model_id: str,
        model_path: str,
        model_type: str,
        features: List[str],
        description: str,
    ) -> None:
        path = Path(model_path)
        if not path.is_file():
            raise FileNotFoundError(str(path))
        model = joblib.load(path)
        self.models[model_id] = model
        self.model_info[model_id] = {
            "model_id": model_id,
            "path": str(path),
            "type": model_type,
            "features": features,
            "description": description,
            "loaded_at": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
        }

    def unregister(self, model_id: str) -> Dict[str, Any]:
        if model_id not in self.models:
            raise KeyError(model_id)
        del self.models[model_id]
        return self.model_info.pop(model_id)

    def predict(
        self,
        model_id: str,
        data: Dict[str, Any],
        return_proba: bool = True,
    ) -> Dict[str, Any]:
        if model_id not in self.models:
            raise KeyError(model_id)
        model = self.models[model_id]
        info = self.model_info[model_id]
        cols = info["features"]
        try:
            input_df = pd.DataFrame([data])[cols]
        except KeyError as e:
            raise ValueError(f"Missing or invalid feature keys for model '{model_id}': {e}") from e

        raw_pred = model.predict(input_df)
        prediction = raw_pred[0]
        pred_scalar: Any
        if hasattr(prediction, "item"):
            pred_scalar = prediction.item()
        else:
            pred_scalar = prediction

        probability: Optional[float] = None
        if return_proba and info["type"] == "classification" and hasattr(model, "predict_proba"):
            proba = model.predict_proba(input_df)[0]
            probability = float(max(proba.tolist()))

        return {
            "model_id": model_id,
            "prediction": pred_scalar,
            "confidence": probability,
            "model_type": info["type"],
            "features_used": cols,
        }


registry = ModelRegistry()
storage = Storage(DB_PATH)


@asynccontextmanager
async def lifespan(app: FastAPI):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    ckd_model_path = MODEL_DIR / "ckd_model.pkl"
    if ckd_model_path.is_file():
        registry.register_model(
            model_id="ckd_risk",
            model_path=str(ckd_model_path),
            model_type="classification",
            features=["age", "diabetes", "systolic_bp", "creatinine", "proteinuria"],
            description="Chronic Kidney Disease progression risk (0=low, 1=high)",
        )
    yield


app = FastAPI(title="Multi-Model ML API Platform", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictionRequest(BaseModel):
    model_id: str
    data: Dict[str, Any]
    return_proba: bool = True
    log_prediction: bool = True


class BatchPredictionRequest(BaseModel):
    model_id: str
    data: List[Dict[str, Any]]
    return_proba: bool = True
    log_prediction: bool = False


class FeedbackRequest(BaseModel):
    model_id: str
    data: Dict[str, Any]
    actual_outcome: float = Field(..., description="Clinician-confirmed label (e.g. 0/1 for binary).")
    predicted: Optional[float] = Field(None, description="Optional: model output at time of review.")


class RetrainRequest(BaseModel):
    model_id: str
    min_samples: int = 10


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "message": "Multi-Model ML Prediction API",
        "available_models": list(registry.models.keys()),
        "version": "2.0",
        "endpoints": [
            "/predict",
            "/batch_predict",
            "/models",
            "/register_model",
            "/feedback",
            "/retrain",
            "/stats/{model_id}",
            "/train",
        ],
    }


@app.post("/train")
async def train_from_csv(
    model_id: str = Form(...),
    target_column: str = Form(...),
    model_type: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Train RandomForest from an uploaded CSV and register the artifact under model_id."""
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}") from e
    if model_type not in ("classification", "regression"):
        raise HTTPException(status_code=400, detail="model_type must be classification or regression")
    try:
        model, meta = train_model_from_dataframe(df, target_column, model_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MODEL_DIR / f"{model_id}.pkl"
    meta_path = MODEL_DIR / f"{model_id}_metadata.json"
    joblib.dump(model, out_path)
    meta_out = {**meta, "model_id": model_id}
    meta_path.write_text(json.dumps(meta_out, indent=2), encoding="utf-8")

    desc = description.strip() or f"Trained from CSV upload ({meta['n_samples']} rows)"
    registry.register_model(model_id, str(out_path), model_type, list(meta["features"]), desc)

    return {
        "message": "Trained and registered",
        "model_id": model_id,
        "metadata": meta_out,
        "artifact": str(out_path),
    }


@app.post("/register_model")
async def register_model(
    model_id: str = Form(...),
    model_type: str = Form(...),
    features: str = Form(..., description='JSON array string, e.g. ["age","bp"]'),
    description: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    try:
        features_list: List[str] = json.loads(features)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid features JSON: {e}") from e
    if not isinstance(features_list, list) or not all(isinstance(x, str) for x in features_list):
        raise HTTPException(status_code=400, detail="features must be a JSON array of strings")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / f"{model_id}.pkl"
    content = await file.read()
    model_path.write_bytes(content)

    try:
        registry.register_model(model_id, str(model_path), model_type, features_list, description)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {
        "message": f"Model '{model_id}' registered successfully",
        "model_id": model_id,
        "features": features_list,
        "path": str(model_path),
    }


@app.post("/predict")
def predict(request: PredictionRequest) -> Dict[str, Any]:
    try:
        result = registry.predict(request.model_id, request.data, return_proba=request.return_proba)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Model '{request.model_id}' not found") from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    conf = result.get("confidence")
    if request.log_prediction:
        try:
            pred_f = float(result["prediction"])
        except (TypeError, ValueError):
            pred_f = float("nan")
        storage.log_prediction(
            request.model_id,
            request.data,
            pred_f,
            float(conf) if conf is not None else None,
        )
    return result


@app.post("/batch_predict")
def batch_predict(request: BatchPredictionRequest) -> Dict[str, Any]:
    results: List[Any] = []
    for data_point in request.data:
        try:
            r = registry.predict(request.model_id, data_point, return_proba=request.return_proba)
            if request.log_prediction:
                conf = r.get("confidence")
                try:
                    pred_f = float(r["prediction"])
                except (TypeError, ValueError):
                    pred_f = float("nan")
                storage.log_prediction(
                    request.model_id,
                    data_point,
                    pred_f,
                    float(conf) if conf is not None else None,
                )
            results.append(r)
        except Exception as e:
            results.append({"error": str(e), "data": data_point})
    return {
        "model_id": request.model_id,
        "total_predictions": len(results),
        "results": results,
    }


@app.get("/models")
def list_models() -> Dict[str, Any]:
    return {
        "models": [{"model_id": mid, "info": info} for mid, info in registry.model_info.items()],
    }


@app.get("/models/{model_id}")
def get_model_info(model_id: str) -> Dict[str, Any]:
    if model_id not in registry.model_info:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return registry.model_info[model_id]


@app.delete("/models/{model_id}")
def unregister_model(model_id: str) -> Dict[str, Any]:
    if model_id not in registry.models:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    info = registry.unregister(model_id)
    return {"message": f"Model '{model_id}' unregistered", "removed_model": info}


@app.post("/feedback")
def feedback(body: FeedbackRequest) -> Dict[str, Any]:
    if body.model_id not in registry.model_info:
        raise HTTPException(status_code=404, detail=f"Model '{body.model_id}' not found")
    fid = storage.insert_feedback(
        body.model_id,
        body.data,
        actual_outcome=body.actual_outcome,
        prediction=body.predicted,
    )
    return {"message": "Feedback stored", "id": fid, "model_id": body.model_id}


@app.get("/stats/{model_id}")
def stats(model_id: str) -> Dict[str, Any]:
    if model_id not in registry.model_info:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return {
        "model_id": model_id,
        "labeled_feedback_rows": storage.feedback_count(model_id),
    }


@app.post("/retrain")
def retrain(req: RetrainRequest) -> Dict[str, Any]:
    if req.model_id not in registry.model_info:
        raise HTTPException(status_code=404, detail=f"Model '{req.model_id}' not found")

    rows = storage.feedback_rows_for_model(req.model_id)
    if len(rows) < req.min_samples:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {req.min_samples} labeled feedback rows; have {len(rows)}.",
        )

    info = registry.model_info[req.model_id]
    feature_names: List[str] = list(info["features"])
    model_type: str = info["type"]

    X_rows: List[Dict[str, float]] = []
    y_vals: List[float] = []
    for r in rows:
        feats = r["features"]
        try:
            X_rows.append({k: float(feats[k]) for k in feature_names})
        except KeyError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Feedback row missing feature {e}; expected {feature_names}",
            ) from e
        y_vals.append(float(r["actual_outcome"]))

    X = pd.DataFrame(X_rows, columns=feature_names)
    y = pd.Series(y_vals, name="label")

    if model_type == "classification":
        new_model = make_rf_classifier()
    elif model_type == "regression":
        new_model = make_rf_regressor()
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported model_type '{model_type}' for retrain")

    new_model.fit(X, y)

    out_path = MODEL_DIR / f"{req.model_id}.pkl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(new_model, out_path)

    registry.register_model(
        model_id=req.model_id,
        model_path=str(out_path),
        model_type=model_type,
        features=feature_names,
        description=info["description"] + " (retrained from feedback)",
    )

    return {
        "message": "Retrain complete; model reloaded in memory",
        "model_id": req.model_id,
        "samples_used": len(rows),
        "artifact": str(out_path),
    }


def main() -> None:
    import uvicorn

    port = _env_int("API_PORT", 8890)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    main()
