import math
from typing import Any, Dict
import pandas as pd

# Variable holding the conversation_id and the dataset
DATASETS: Dict[str, pd.DataFrame] = {}


def _to_json_safe(value: Any):
    if value is None or isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if isinstance(value, dict):
        return {str(k): _to_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_to_json_safe(v) for v in value]

    # Convert numpy/pandas scalar types to Python primitives when possible.
    if hasattr(value, "item"):
        try:
            return _to_json_safe(value.item())
        except Exception:
            pass

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    return str(value)

def load_dataset(path: str, conversation_id: str = "default"):
    global DATASETS
    df = pd.read_csv(path)
    DATASETS[conversation_id] = df
    return _to_json_safe({"columns": list(df.columns), "rows": len(df)})

def describe_dataset(conversation_id: str = "default"):
    df = DATASETS.get(conversation_id)
    if df is None:
        return "No dataset loaded for this conversation"
    summary = df.describe(include="all").to_dict()
    return _to_json_safe(summary)

def clear_dataset(conversation_id: str):
    DATASETS.pop(conversation_id, None)