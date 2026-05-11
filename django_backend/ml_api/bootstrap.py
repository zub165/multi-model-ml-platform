"""Load default artifacts (e.g. CKD) on startup."""

from __future__ import annotations

from pathlib import Path

from django.conf import settings

from ml_api.registry import registry


def bootstrap_models() -> None:
    model_dir: Path = settings.MODEL_DIR
    model_dir.mkdir(parents=True, exist_ok=True)
    ckd = model_dir / "ckd_model.pkl"
    if ckd.is_file():
        registry.register_model(
            model_id="ckd_risk",
            model_path=str(ckd),
            model_type="classification",
            features=["age", "diabetes", "systolic_bp", "creatinine", "proteinuria"],
            description="Chronic Kidney Disease progression risk (0=low, 1=high)",
        )
