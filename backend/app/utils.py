import pandas as pd
import numpy as np
from pathlib import Path
from urllib.parse import urlparse

FILE_URL_CACHE = {}


def _read_dataframe(path: str) -> pd.DataFrame:
    parsed_url = urlparse(path)
    source_path = parsed_url.path if parsed_url.scheme in {"http", "https"} else path
    extension = Path(source_path).suffix.lower()
    if extension == ".csv":
        return pd.read_csv(path)
    if extension in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    raise ValueError("Unsupported file format. Please upload .csv, .xlsx, or .xls files.")

def _json_safe(value):
    """Recursively convert pandas/numpy values to JSON-safe Python values."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}

    if isinstance(value, list):
        return [_json_safe(v) for v in value]

    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]

    if isinstance(value, np.integer):
        return int(value)

    if isinstance(value, np.floating):
        value = float(value)
        return value if np.isfinite(value) else None

    if value is pd.NA:
        return None

    if isinstance(value, float):
        return value if np.isfinite(value) else None

    return value

def set_file_url(conversation_id, url):
    FILE_URL_CACHE[conversation_id] = url

def get_file_url(conversation_id):
    return FILE_URL_CACHE.get(conversation_id)

def load_dataset(path: str):
    df = _read_dataframe(path)

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
        corr_pairs = corr_pairs[corr_pairs["col_1"] != corr_pairs["col_2"]]
        corr_pairs = corr_pairs[np.isfinite(corr_pairs["correlation"])]
        corr_pairs["pair_key"] = corr_pairs.apply(
            lambda row: "||".join(sorted((str(row["col_1"]), str(row["col_2"])))),
            axis=1,
        )
        corr_pairs = corr_pairs.drop_duplicates(subset=["pair_key"]).drop(columns=["pair_key"])
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

    # histograms for numeric variables
    histograms = []

    for col in numeric.columns:
        values = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float, copy=False)
        finite_values = values[np.isfinite(values)]

        if finite_values.size == 0:
            histograms.append({
                "type": "histogram",
                "column": col,
                "labels": [],
                "data": []
            })
            continue

        counts, bins = np.histogram(finite_values, bins=10)
        labels = [
            f"{float(bins[index]):.3f} - {float(bins[index + 1]):.3f}"
            for index in range(len(bins) - 1)
        ]

        histograms.append({
            "type": "histogram",
            "column": col,
            "labels": labels,
            "data": counts.tolist()
        })

    results["histograms"] = histograms

    # pie charts for categorical variables
    categorical_pie_charts = []

    for col in categorical.columns:
        value_counts = (
            categorical[col]
            .dropna()
            .astype(str)
            .value_counts()
        )

        if value_counts.empty:
            continue

        top_counts = value_counts.head(8)
        remaining = int(value_counts.iloc[8:].sum())

        labels = top_counts.index.tolist()
        data = top_counts.values.astype(int).tolist()

        if remaining > 0:
            labels.append("Other")
            data.append(remaining)

        categorical_pie_charts.append({
            "type": "pie",
            "column": col,
            "labels": labels,
            "data": data,
        })

    results["categorical_pie_charts"] = categorical_pie_charts

    return _json_safe(results)