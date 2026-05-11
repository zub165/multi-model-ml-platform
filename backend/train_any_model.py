"""Train sklearn models from CSV (CLI) or from an in-memory DataFrame (API)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Tuple

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor


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
        model = RandomForestClassifier(n_estimators=100, random_state=42)
    elif model_type == "regression":
        model = RandomForestRegressor(n_estimators=100, random_state=42)
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


def train_model(
    data_path: Path,
    target_column: str,
    model_type: str,
    model_name: str,
) -> Tuple[Any, dict]:
    df = pd.read_csv(data_path)
    model, metadata = train_model_from_dataframe(df, target_column, model_type)

    out_pkl = Path(f"{model_name}.pkl")
    joblib.dump(model, out_pkl)

    metadata = {**metadata, "model_name": model_name}
    meta_path = Path(f"{model_name}_metadata.json")
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Saved model: {out_pkl.resolve()}")
    print(f"Saved metadata: {meta_path.resolve()}")
    return model, metadata


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="Path to CSV")
    p.add_argument("--target", required=True, help="Target column name")
    p.add_argument("--type", choices=("classification", "regression"), required=True)
    p.add_argument("--name", required=True, help="Base name for outputs (without extension)")
    args = p.parse_args()

    train_model(Path(args.data), args.target, args.type, args.name)


if __name__ == "__main__":
    main()
