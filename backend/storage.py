"""SQLite persistence for prediction logs and labeled feedback (learning loop)."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS prediction_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    model_id TEXT NOT NULL,
                    features_json TEXT NOT NULL,
                    prediction REAL,
                    confidence REAL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    model_id TEXT NOT NULL,
                    features_json TEXT NOT NULL,
                    prediction REAL,
                    actual_outcome REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_feedback_model
                    ON feedback(model_id);
                CREATE INDEX IF NOT EXISTS idx_predlog_model
                    ON prediction_log(model_id);
                """
            )

    def log_prediction(
        self,
        model_id: str,
        features: Dict[str, Any],
        prediction: float,
        confidence: Optional[float],
    ) -> int:
        payload = json.dumps(features, sort_keys=True)
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prediction_log
                    (model_id, features_json, prediction, confidence, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (model_id, payload, float(prediction), confidence, _utc_now()),
            )
            return int(cur.lastrowid)

    def insert_feedback(
        self,
        model_id: str,
        features: Dict[str, Any],
        actual_outcome: float,
        prediction: Optional[float] = None,
    ) -> int:
        payload = json.dumps(features, sort_keys=True)
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO feedback
                    (model_id, features_json, prediction, actual_outcome, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (model_id, payload, prediction, float(actual_outcome), _utc_now()),
            )
            return int(cur.lastrowid)

    def feedback_rows_for_model(self, model_id: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT features_json, actual_outcome FROM feedback WHERE model_id = ?",
                (model_id,),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "features": json.loads(r["features_json"]),
                    "actual_outcome": float(r["actual_outcome"]),
                }
            )
        return out

    def feedback_count(self, model_id: str) -> int:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(1) AS c FROM feedback WHERE model_id = ?",
                (model_id,),
            ).fetchone()
        return int(row["c"]) if row else 0
