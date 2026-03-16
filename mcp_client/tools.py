import pandas as pd
import numpy as np

from utils import get_dataset, profile_dataset

def describe_dataset(url):
    """
    Provides an overview of the dataset, including number of rows, columns,
    summary statistics for numeric and categorical variables, missing values,
    and top correlations.
    """
    profiled_dataset = profile_dataset(url)
    if profiled_dataset is None:
        return "No dataset loaded for this conversation"

    return profiled_dataset

def query_dataset(
    url: str,
    select: list[str] | None = None,
    filters: dict | None = None,
    groupby: list[str] | None = None,
    aggregations: dict | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
    limit: int | None = 20
):
    """
    Perform tabular queries over the dataset including filtering,
    grouping, aggregations, sorting and limiting results.
    """

    df = get_dataset(url)

    if df is None:
        return {"error": "Dataset not loaded"}

    #Check all columns in parameters exist in the dataset
    all_columns = set(df.columns)
    if select and not set(select).issubset(all_columns):
        return {"error": f"One or more columns in select not found in dataset: {set(select) - all_columns}"}
    if filters and not set(filters.keys()).issubset(all_columns):
        return {"error": f"One or more columns in filters not found in dataset: {set(filters.keys()) - all_columns}"}
    if groupby and not set(groupby).issubset(all_columns):
        return {"error": f"One or more columns in groupby not found in dataset: {set(groupby) - all_columns}"}
    if aggregations and not set(aggregations.keys()).issubset(all_columns):
        return {"error": f"One or more columns in aggregations not found in dataset: {set(aggregations.keys()) - all_columns}"}

    result = df.copy()

    # filtering
    if filters:
        for col, val in filters.items():
            result = result[result[col] == val]

    # groupby + aggregation
    if groupby and aggregations:
        result = result.groupby(groupby).agg(aggregations).reset_index()

    # select columns
    if select:
        result = result[select]

    # sorting
    if sort_by:
        result = result.sort_values(sort_by, ascending=(sort_order == "asc"))

    # limit rows
    if limit:
        result = result.head(limit)

    return {
        "columns": result.columns.tolist(),
        "rows": result.values.tolist()
    }


def detect_outliers(url: str, column: str):
    """
    Detects outliers in a numeric column using z-score method.
    """
    dataset = get_dataset(url)
    if dataset is None:
        return "No dataset loaded for this conversation"

    if column not in dataset.columns:
        return f"Column {column} not found in dataset"

    if not pd.api.types.is_numeric_dtype(dataset[column]):
        return f"Column {column} is not numeric"

    col_data = dataset[column].dropna()
    mean = col_data.mean()
    std = col_data.std()

    # If variance is zero (or undefined), z-score cannot identify outliers.
    if pd.isna(std) or std == 0:
        return {
            "column": column,
            "outlier_count": 0,
            "rows": []
        }

    z_scores = (col_data - mean) / std
    outliers = col_data[abs(z_scores) > 3]

    outlier_rows = outliers.head(20).reset_index()
    outlier_rows.columns = ["row_index", "value"]

    return {
        "column": column,
        "outlier_count": int(len(outliers)),
        "rows": outlier_rows.to_dict(orient="records")
    }


def generate_chart(
    url: str,
    chart_type: str,
    x: str,
    y: str | None = None,
    aggregation: str | None = None,
    bins: int = 10
):
    """
    Generate chart-ready data from the dataset.
    """

    df = get_dataset(url)

    if df is None:
        return {"error": "Dataset not loaded"}

    if x not in df.columns:
        return {"error": f"Column {x} not found"}

    # Histogram
    if chart_type == "histogram":

        values = df[x].dropna()

        counts, edges = np.histogram(values, bins=bins)

        labels = [
            f"{round(edges[i],2)}-{round(edges[i+1],2)}"
            for i in range(len(edges)-1)
        ]

        return {
            "type": "bar",
            "title": f"Distribution of {x}",
            "data": {
                "labels": labels,
                "datasets": [
                    {"label": x, "data": counts.tolist()}
                ]
            }
        }

    # Bar / aggregated chart
    if chart_type == "bar":

        if y and aggregation:

            grouped = (
                df.groupby(x)[y]
                .agg(aggregation)
                .reset_index()
                .sort_values(y, ascending=False)
                .head(20)
            )

            return {
                "type": "bar",
                "title": f"{aggregation} of {y} by {x}",
                "data": {
                    "labels": grouped[x].astype(str).tolist(),
                    "datasets": [
                        {"label": y, "data": grouped[y].tolist()}
                    ]
                }
            }

        else:

            counts = df[x].value_counts().head(20)

            return {
                "type": "bar",
                "title": f"Count of {x}",
                "data": {
                    "labels": counts.index.astype(str).tolist(),
                    "datasets": [
                        {"label": x, "data": counts.values.tolist()}
                    ]
                }
            }

    # Scatter
    if chart_type == "scatter":

        if not y or y not in df.columns:
            return {"error": "Scatter chart requires x and y columns"}

        sample = df[[x, y]].dropna().head(500)

        return {
            "type": "scatter",
            "title": f"{y} vs {x}",
            "data": {
                "datasets": [
                    {
                        "label": f"{y} vs {x}",
                        "data": [
                            {"x": row[x], "y": row[y]}
                            for _, row in sample.iterrows()
                        ]
                    }
                ]
            }
        }

    return {"error": "Unsupported chart type"}

def compute_correlation(
    url: str,
    target: str | None = None,
    method: str = "pearson",
    top_k: int = 10
):
    """
    Compute correlations between numeric variables.
    If target is provided, return correlations with that column.
    """

    df = get_dataset(url)

    if df is None:
        return {"error": "Dataset not loaded"}

    numeric_df = df.select_dtypes(include="number")

    if numeric_df.shape[1] < 2:
        return {"error": "Not enough numeric columns for correlation"}

    corr_matrix = numeric_df.corr(method=method)

    # correlations with a target column
    if target:

        if target not in corr_matrix.columns:
            return {"error": f"{target} is not numeric or not found"}

        corr_series = (
            corr_matrix[target]
            .drop(target)
            .sort_values(ascending=False)
            .head(top_k)
        )

        return {
            "target": target,
            "correlations": [
                {"feature": col, "correlation": float(val).__round__(3)}
                for col, val in corr_series.items()
            ]
        }

    # full matrix
    return {
        "columns": corr_matrix.columns.tolist(),
        "matrix": corr_matrix.round(3).values.tolist()
    }

def generate_insights(
    url: str,
    corr_threshold: float = 0.7,
    dominance_threshold: float = 0.6,
    missing_threshold: float = 0.1
):
    """
    Automatically detect important statistical insights in the dataset.
    """

    df = get_dataset(url)

    if df is None:
        return {"error": "Dataset not loaded"}

    insights = []

    # ---- missing values ----
    missing_ratio = df.isnull().mean()

    for col, ratio in missing_ratio.items():
        if ratio > missing_threshold:
            insights.append(
                f"Column '{col}' has {round(ratio*100,1)}% missing values"
            )

    # ---- categorical dominance ----
    cat_cols = df.select_dtypes(include=["object", "category", "bool"]).columns

    for col in cat_cols:
        counts = df[col].value_counts(normalize=True)
        if len(counts) > 0 and counts.iloc[0] > dominance_threshold:
            insights.append(
                f"Category '{counts.index[0]}' dominates column '{col}' with {round(counts.iloc[0]*100,1)}% of rows"
            )

    # ---- skewness numeric ----
    num_cols = df.select_dtypes(include="number").columns

    for col in num_cols:
        skew = df[col].skew()
        if abs(skew) > 1:
            direction = "right" if skew > 0 else "left"
            insights.append(
                f"Column '{col}' is heavily {direction}-skewed (skew={round(skew,2)})"
            )

    # ---- strong correlations ----
    if len(num_cols) > 1:

        corr = df[num_cols].corr()

        for i in range(len(num_cols)):
            for j in range(i + 1, len(num_cols)):

                val = corr.iloc[i, j]

                if abs(val) >= corr_threshold:

                    insights.append(
                        f"Strong correlation detected between '{num_cols[i]}' and '{num_cols[j]}' ({round(val,2)})"
                    )

    return {
        "insights": insights
    }