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

    return {
        "conversation_id": profiled_dataset["conversation_id"],
        "dataset_info": profiled_dataset["dataset_info"],
    }


def groupby_analysis(url: str, group_by: str, metric: str, aggregation: str):
    """
    Performs a groupby analysis on the dataset, grouping by the specified column
    and calculating the specified metric (e.g., mean, sum) using the specified aggregation function.
    """
    dataset = get_dataset(url)
    if dataset is None:
        return "No dataset loaded for this conversation"

    if group_by not in dataset.columns:
        return f"Column {group_by} not found in dataset"
    
    if metric not in dataset.columns:
        return {"error": f"{metric} not found"}
    
    grouped = dataset.groupby(group_by)[metric]

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

    z_scores = (col_data - mean) / std
    outliers = col_data[abs(z_scores) > 3]

    return {
        "column": column,
        "outlier_count": int(len(outliers)),
        "rows": outliers.head(20).to_dict(orient="records")
    }


def generate_chart_data(url: str, chart_type: str, column: str):
    """
    Generates data for different chart type (histogram, bar) of a specific column.
    """
    dataset = get_dataset(url)
    if dataset is None:
        return "No dataset loaded for this conversation"

    if column not in dataset.columns:
        return f"Column {column} not found in dataset"

    if chart_type == "histogram":

        counts, bins = np.histogram(dataset[column], bins=10)

        return {
            "type": "histogram",
            "column": column,
            "labels": bins[:-1].tolist(),
            "values": counts.tolist()
        }

    elif chart_type == "bar":

        counts = dataset[column].value_counts().head(10)

        return {
            "type": "bar",
            "column": column,
            "labels": counts.index.tolist(),
            "values": counts.values.tolist()
        }

    else:
        return {"error": "unsupported chart type"}
    

def dataset_schema(url: str):
    """Returns the dataset schema, including column names and data types."""

    dataset = get_dataset(url)
    if dataset is None:
        return "No dataset loaded for this conversation"

    return {
        "columns": {
            col: str(dataset[col].dtype)
            for col in dataset.columns
        }
    }