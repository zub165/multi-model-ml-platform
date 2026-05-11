"""In-memory sklearn model registry (same behavior as FastAPI backend)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd


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
