"""Match FastAPI `train_any_model.train_model_from_dataframe` for parity."""

from __future__ import annotations

from typing import Any, Dict, Tuple

import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor


def make_rf_classifier() -> RandomForestClassifier:
    """Clinical risk defaults (matches FastAPI train_any_model)."""
    return RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        class_weight="balanced",
        min_samples_leaf=2,
        max_depth=12,
    )


def make_rf_regressor() -> RandomForestRegressor:
    return RandomForestRegressor(n_estimators=100, random_state=42, min_samples_leaf=2)


def train_model_from_dataframe(
    df: pd.DataFrame,
    target_column: str,
    model_type: str,
) -> Tuple[Any, Dict[str, Any]]:
    if target_column not in df.columns:
        raise ValueError(f"Target column '{target_column}' not in CSV columns: {list(df.columns)}")

    X = df.drop(columns=[target_column])
    y = df[target_column]
    if X.shape[1] == 0:
        raise ValueError("No feature columns remain after dropping the target column")

    if model_type == "classification":
        model = make_rf_classifier()
    elif model_type == "regression":
        model = make_rf_regressor()
    else:
        raise ValueError("model_type must be 'classification' or 'regression'")

    model.fit(X, y)

    metadata: Dict[str, Any] = {
        "model_type": model_type,
        "features": list(X.columns),
        "target_column": target_column,
        "n_samples": int(len(df)),
        "n_features": int(X.shape[1]),
    }
    return model, metadata
