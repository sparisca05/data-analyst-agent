import pandas as pd
import numpy as np

FILE_URL_CACHE = {}

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
    df = pd.read_csv(path)

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

    return _json_safe(results)