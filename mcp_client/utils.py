import pandas as pd

DATASET_CACHE = {}

def get_dataset(url):
    if url not in DATASET_CACHE:
        df = pd.read_csv(url)
        DATASET_CACHE[url] = df

    return DATASET_CACHE[url]


def profile_dataset(url):
    df = get_dataset(url)

    results = {}

    # dataset info
    results["rows"] = len(df)
    # columns with their types
    results["columns"] = {col: str(dtype) for col, dtype in df.dtypes.items()}

    return results
