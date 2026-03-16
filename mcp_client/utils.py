import pandas as pd
import numpy as np

DATASET_CACHE = {}

def get_dataset(url):
   
    if url not in DATASET_CACHE:
        df = pd.read_csv(url)
        DATASET_CACHE[url] = df

    return DATASET_CACHE[url]


def profile_dataset(url):
    df = get_dataset(url)

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

    return results
