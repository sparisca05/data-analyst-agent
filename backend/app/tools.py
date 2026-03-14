import pandas as pd
import numpy as np

from app.utils import RAW_DATASETS, _get_dataset_entry

def describe_dataset(conversation_id: str = "default"):
    """
    Provides an overview of the dataset, including number of rows, columns,
    summary statistics for numeric and categorical variables, missing values,
    and top correlations.
    """
    entry = _get_dataset_entry(conversation_id)
    if entry is None:
        return "No dataset loaded for this conversation"

    return {
        "conversation_id": entry["conversation_id"],
        "dataset_info": entry["dataset_info"],
    }


def groupby_analysis(conversation_id: str, group_by: str, metric: str, aggregation: str):
    """
    Performs a groupby analysis on the dataset, grouping by the specified column
    and calculating the specified metric (e.g., mean, sum) using the specified aggregation function.
    """
    entry = RAW_DATASETS.get(conversation_id)
    if entry is None:
        return "No dataset loaded for this conversation"

    if group_by not in entry.columns:
        return f"Column {group_by} not found in dataset"
    
    if metric not in entry.columns:
        return {"error": f"{metric} not found"}
    
    grouped = entry.groupby(group_by)[metric]

    if aggregation == "mean":
        result = grouped.mean()

    elif aggregation == "sum":
        result = grouped.sum()

    elif aggregation == "max":
        result = grouped.max()

    elif aggregation == "min":
        result = grouped.min()

    elif aggregation == "count":
        result = grouped.count()

    else:
        return {"error": "unsupported aggregation"}

    return result.to_dict()


def detect_outliers(conversation_id: str, column: str):
    """
    Detects outliers in a numeric column using z-score method.
    """
    entry = RAW_DATASETS.get(conversation_id)
    if entry is None:
        return "No dataset loaded for this conversation"

    if column not in entry.columns:
        return f"Column {column} not found in dataset"

    if not pd.api.types.is_numeric_dtype(entry[column]):
        return f"Column {column} is not numeric"

    col_data = entry[column].dropna()
    mean = col_data.mean()
    std = col_data.std()

    z_scores = (col_data - mean) / std
    outliers = col_data[abs(z_scores) > 3]

    return {
        "column": column,
        "outlier_count": int(len(outliers)),
        "rows": outliers.head(20).to_dict(orient="records")
    }


def generate_chart_data(conversation_id: str, chart_type: str, column: str):
    """
    Generates data for different chart type (histogram, bar) of a specific column.
    """
    entry = RAW_DATASETS.get(conversation_id)
    if entry is None:
        return "No dataset loaded for this conversation"

    if column not in entry.columns:
        return f"Column {column} not found in dataset"

    if chart_type == "histogram":

        counts, bins = np.histogram(entry[column], bins=10)

        return {
            "type": "histogram",
            "column": column,
            "labels": bins[:-1].tolist(),
            "values": counts.tolist()
        }

    elif chart_type == "bar":

        counts = entry[column].value_counts().head(10)

        return {
            "type": "bar",
            "column": column,
            "labels": counts.index.tolist(),
            "values": counts.values.tolist()
        }

    else:
        return {"error": "unsupported chart type"}
    

def dataset_schema(conversation_id: str):
    """Returns the dataset schema, including column names and data types."""

    entry = RAW_DATASETS.get(conversation_id)
    if entry is None:
        return "No dataset loaded for this conversation"

    return {
        "columns": {
            col: str(entry[col].dtype)
            for col in entry.columns
        }
    }