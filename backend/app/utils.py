from typing import Any, Dict, List, Optional
import pandas as pd
import numpy as np

RAW_DATASETS: Dict[str, pd.DataFrame] = {}
# Stores one dataset snapshot per conversation.
DATASETS: List[Dict[str, Any]] = []


def _upsert_dataset_entry(conversation_id: str, dataset_info: Dict[str, Any]) -> None:
    for entry in DATASETS:
        if entry["conversation_id"] == conversation_id:
            entry["dataset_info"] = dataset_info
            return

    DATASETS.append({
        "conversation_id": conversation_id,
        "dataset_info": dataset_info,
    })

def _get_dataset_entry(conversation_id: str) -> Optional[Dict[str, Any]]:
    for entry in DATASETS:
        if entry["conversation_id"] == conversation_id:
            return entry
    return None

def load_dataset(path: str, conversation_id: str = "default"):
    df = pd.read_csv(path)
    RAW_DATASETS[conversation_id] = df

    numeric = df.select_dtypes(include="number")
    categorical = df.select_dtypes(exclude="number")

    results = {}

    # dataset info
    results["rows"] = len(df)
    results["columns"] = list(df.columns)

    # statistics
    numeric_stats = numeric.describe().to_dict() if not numeric.empty else {}
    categorical_stats = {col: categorical[col].value_counts().to_dict() for col in categorical.columns if categorical[col].nunique() < 10} # ignore variable with too many unique values
    results["summary"] = {
        "numeric": numeric_stats,
        "categorical": categorical_stats
    }


    # missing values
    missing_by_column = df.isna().sum().to_dict()
    results["missing_values"] = {
        "total": int(df.isna().sum().sum()),
        "by_column": {col: int(value) for col, value in missing_by_column.items() if value > 0},
    }

    # correlation
    corr = numeric.corr() if numeric.shape[1] >= 2 else pd.DataFrame()

    results["correlation_chart"] = {
        "type": "heatmap",
        "labels": list(corr.columns),
        "data": corr.values.tolist()
    }

    top_correlations = []
    if not corr.empty:
        corr_pairs = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool)).stack().reset_index()
        corr_pairs.columns = ["col_1", "col_2", "correlation"]
        corr_pairs["abs_correlation"] = corr_pairs["correlation"].abs()
        top_pairs = corr_pairs.sort_values("abs_correlation", ascending=False).head(5)

        top_correlations = [
            {
                "col_1": row["col_1"],
                "col_2": row["col_2"],
                "correlation": float(row["correlation"]).__round__(3),
            }
            for _, row in top_pairs.iterrows()
        ]

    results["top_correlations"] = top_correlations

    # histograms
    histograms = []

    for col in numeric.columns[:5]:

        counts, bins = np.histogram(df[col], bins=10)

        histograms.append({
            "type": "histogram",
            "column": col,
            "labels": bins[:-1].tolist(),
            "data": counts.tolist()
        })

    results["histograms"] = histograms

    # Store the dataset info in the global DATASETS list
    dataset_info = {
        "rows": results["rows"],
        "columns": results["columns"],
        "summary": results["summary"],
        "missing_values": results["missing_values"],
        "top_correlations": results["top_correlations"],
    }
    _upsert_dataset_entry(conversation_id=conversation_id, dataset_info=dataset_info)

    return results


def clear_dataset(conversation_id: str):
    DATASETS[:] = [entry for entry in DATASETS if entry["conversation_id"] != conversation_id]
    if conversation_id in RAW_DATASETS:
        del RAW_DATASETS[conversation_id]