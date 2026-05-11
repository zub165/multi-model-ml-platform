"""HTTP handlers mirroring FastAPI routes and JSON shapes."""

from __future__ import annotations

import io
import json
from typing import Any, Dict, List

import joblib
import pandas as pd
from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

from ml_api import services
from ml_api.registry import registry
from ml_api.training import train_model_from_dataframe


def _detail(msg: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"detail": msg}, status=status)


def _read_json(request: HttpRequest) -> Dict[str, Any]:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e


def root(_request: HttpRequest) -> JsonResponse:
    return JsonResponse(
        {
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
    )


def health(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


@csrf_exempt
def predict(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)
    try:
        body = _read_json(request)
    except ValueError as e:
        return _detail(str(e), 400)

    model_id = body.get("model_id")
    data = body.get("data")
    if not isinstance(model_id, str) or not isinstance(data, dict):
        return _detail("model_id (string) and data (object) are required", 400)
    return_proba = bool(body.get("return_proba", True))
    log_prediction = bool(body.get("log_prediction", True))

    try:
        result = registry.predict(model_id, data, return_proba=return_proba)
    except KeyError:
        return _detail(f"Model '{model_id}' not found", 404)
    except ValueError as e:
        return _detail(str(e), 400)

    conf = result.get("confidence")
    if log_prediction:
        try:
            pred_f = float(result["prediction"])
        except (TypeError, ValueError):
            pred_f = float("nan")
        services.log_prediction(
            model_id,
            data,
            pred_f,
            float(conf) if conf is not None else None,
        )
    return JsonResponse(result)


@csrf_exempt
def batch_predict(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)
    try:
        body = _read_json(request)
    except ValueError as e:
        return _detail(str(e), 400)

    model_id = body.get("model_id")
    rows = body.get("data")
    if not isinstance(model_id, str) or not isinstance(rows, list):
        return _detail("model_id (string) and data (array) are required", 400)
    return_proba = bool(body.get("return_proba", True))
    log_prediction = bool(body.get("log_prediction", False))

    results: List[Any] = []
    for data_point in rows:
        if not isinstance(data_point, dict):
            results.append({"error": "Each batch item must be an object", "data": data_point})
            continue
        try:
            r = registry.predict(model_id, data_point, return_proba=return_proba)
            if log_prediction:
                conf = r.get("confidence")
                try:
                    pred_f = float(r["prediction"])
                except (TypeError, ValueError):
                    pred_f = float("nan")
                services.log_prediction(
                    model_id,
                    data_point,
                    pred_f,
                    float(conf) if conf is not None else None,
                )
            results.append(r)
        except Exception as e:
            results.append({"error": str(e), "data": data_point})

    return JsonResponse({"model_id": model_id, "total_predictions": len(results), "results": results})


def list_models(_request: HttpRequest) -> JsonResponse:
    return JsonResponse(
        {"models": [{"model_id": mid, "info": info} for mid, info in registry.model_info.items()]}
    )


def model_detail(request: HttpRequest, model_id: str) -> JsonResponse:
    if request.method == "GET":
        if model_id not in registry.model_info:
            return _detail(f"Model '{model_id}' not found", 404)
        return JsonResponse(registry.model_info[model_id])
    if request.method == "DELETE":
        if model_id not in registry.models:
            return _detail(f"Model '{model_id}' not found", 404)
        info = registry.unregister(model_id)
        return JsonResponse({"message": f"Model '{model_id}' unregistered", "removed_model": info})
    return _detail("Method not allowed", 405)


@csrf_exempt
def register_model(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)

    model_id = request.POST.get("model_id")
    model_type = request.POST.get("model_type")
    features_raw = request.POST.get("features")
    description = request.POST.get("description")
    upload = request.FILES.get("file")

    if not model_id or not model_type or not features_raw or not description or not upload:
        return _detail("model_id, model_type, features, description, and file are required", 400)

    try:
        features_list = json.loads(features_raw)
    except json.JSONDecodeError as e:
        return _detail(f"Invalid features JSON: {e}", 400)
    if not isinstance(features_list, list) or not all(isinstance(x, str) for x in features_list):
        return _detail("features must be a JSON array of strings", 400)

    model_dir = settings.MODEL_DIR
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{model_id}.pkl"
    model_path.write_bytes(upload.read())

    try:
        registry.register_model(model_id, str(model_path), model_type, features_list, description)
    except Exception as e:
        return _detail(str(e), 400)

    return JsonResponse(
        {
            "message": f"Model '{model_id}' registered successfully",
            "model_id": model_id,
            "features": features_list,
            "path": str(model_path),
        }
    )


@csrf_exempt
def feedback(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)
    try:
        body = _read_json(request)
    except ValueError as e:
        return _detail(str(e), 400)

    model_id = body.get("model_id")
    data = body.get("data")
    if "actual_outcome" not in body:
        return _detail("actual_outcome is required", 400)
    if not isinstance(model_id, str) or not isinstance(data, dict):
        return _detail("model_id (string) and data (object) are required", 400)

    if model_id not in registry.model_info:
        return _detail(f"Model '{model_id}' not found", 404)

    try:
        actual = float(body["actual_outcome"])
    except (TypeError, ValueError):
        return _detail("actual_outcome must be a number", 400)

    predicted = body.get("predicted")
    pred_f: float | None
    if predicted is None:
        pred_f = None
    else:
        try:
            pred_f = float(predicted)
        except (TypeError, ValueError):
            return _detail("predicted must be a number when provided", 400)

    fid = services.insert_feedback(model_id, data, actual_outcome=actual, prediction=pred_f)
    return JsonResponse({"message": "Feedback stored", "id": fid, "model_id": model_id})


def stats(_request: HttpRequest, model_id: str) -> JsonResponse:
    if model_id not in registry.model_info:
        return _detail(f"Model '{model_id}' not found", 404)
    return JsonResponse(
        {"model_id": model_id, "labeled_feedback_rows": services.feedback_count(model_id)}
    )


@csrf_exempt
def train_from_csv(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)

    model_id = request.POST.get("model_id")
    target_column = request.POST.get("target_column")
    model_type = request.POST.get("model_type")
    description = (request.POST.get("description") or "").strip()
    upload = request.FILES.get("file")

    if not model_id or not target_column or not model_type or not upload:
        return _detail("model_id, target_column, model_type, and file are required", 400)
    if model_type not in ("classification", "regression"):
        return _detail("model_type must be classification or regression", 400)

    raw = upload.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        return _detail(f"Invalid CSV: {e}", 400)

    try:
        model, meta = train_model_from_dataframe(df, target_column, model_type)
    except ValueError as e:
        return _detail(str(e), 400)

    model_dir = settings.MODEL_DIR
    model_dir.mkdir(parents=True, exist_ok=True)
    out_path = model_dir / f"{model_id}.pkl"
    meta_path = model_dir / f"{model_id}_metadata.json"
    joblib.dump(model, out_path)
    meta_out = {**meta, "model_id": model_id}
    meta_path.write_text(json.dumps(meta_out, indent=2), encoding="utf-8")

    desc = description or f"Trained from CSV upload ({meta['n_samples']} rows)"
    registry.register_model(model_id, str(out_path), model_type, list(meta["features"]), desc)

    return JsonResponse(
        {
            "message": "Trained and registered",
            "model_id": model_id,
            "metadata": meta_out,
            "artifact": str(out_path),
        }
    )


@csrf_exempt
def retrain(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return _detail("Method not allowed", 405)
    try:
        body = _read_json(request)
    except ValueError as e:
        return _detail(str(e), 400)

    model_id = body.get("model_id")
    if not isinstance(model_id, str):
        return _detail("model_id (string) is required", 400)
    min_samples = int(body.get("min_samples", 10))

    if model_id not in registry.model_info:
        return _detail(f"Model '{model_id}' not found", 404)

    rows = services.feedback_rows_for_model(model_id)
    if len(rows) < min_samples:
        return _detail(f"Need at least {min_samples} labeled feedback rows; have {len(rows)}.", 400)

    info = registry.model_info[model_id]
    feature_names: List[str] = list(info["features"])
    model_type: str = info["type"]

    X_rows: List[Dict[str, float]] = []
    y_vals: List[float] = []
    for r in rows:
        feats = r["features"]
        try:
            X_rows.append({k: float(feats[k]) for k in feature_names})
        except KeyError as e:
            return _detail(f"Feedback row missing feature {e}; expected {feature_names}", 400)
        y_vals.append(float(r["actual_outcome"]))

    X = pd.DataFrame(X_rows, columns=feature_names)
    y = pd.Series(y_vals, name="label")

    if model_type == "classification":
        new_model = RandomForestClassifier(n_estimators=150, random_state=42)
    elif model_type == "regression":
        new_model = RandomForestRegressor(n_estimators=150, random_state=42)
    else:
        return _detail(f"Unsupported model_type '{model_type}' for retrain", 400)

    new_model.fit(X, y)

    out_path = settings.MODEL_DIR / f"{model_id}.pkl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(new_model, out_path)

    registry.register_model(
        model_id=model_id,
        model_path=str(out_path),
        model_type=model_type,
        features=feature_names,
        description=str(info["description"]) + " (retrained from feedback)",
    )

    return JsonResponse(
        {
            "message": "Retrain complete; model reloaded in memory",
            "model_id": model_id,
            "samples_used": len(rows),
            "artifact": str(out_path),
        }
    )
