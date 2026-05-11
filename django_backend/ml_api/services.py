"""Persistence helpers mirroring FastAPI `storage.Storage` semantics."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ml_api.models import LabelFeedback, PredictionLog


def log_prediction(
    model_id: str,
    features: Dict[str, Any],
    prediction: float,
    confidence: Optional[float],
) -> int:
    row = PredictionLog.objects.create(
        model_id=model_id,
        features_json=json.dumps(features, sort_keys=True),
        prediction=prediction,
        confidence=confidence,
    )
    return int(row.pk)


def insert_feedback(
    model_id: str,
    features: Dict[str, Any],
    actual_outcome: float,
    prediction: Optional[float] = None,
) -> int:
    row = LabelFeedback.objects.create(
        model_id=model_id,
        features_json=json.dumps(features, sort_keys=True),
        prediction=prediction,
        actual_outcome=float(actual_outcome),
    )
    return int(row.pk)


def feedback_rows_for_model(model_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in LabelFeedback.objects.filter(model_id=model_id).iterator():
        out.append(
            {
                "features": json.loads(r.features_json),
                "actual_outcome": float(r.actual_outcome),
            }
        )
    return out


def feedback_count(model_id: str) -> int:
    return int(LabelFeedback.objects.filter(model_id=model_id).count())
