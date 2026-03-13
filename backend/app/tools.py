import pandas as pd

DATASET = None

def load_dataset(path: str):
    global DATASET
    DATASET = pd.read_csv(path)
    return {"columns": list(DATASET.columns), "rows": len(DATASET)}

def describe_dataset():
    global DATASET
    if DATASET is None:
        return "No dataset loaded"
    return DATASET.describe().to_dict()