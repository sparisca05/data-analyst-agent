import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

FILE_URL_CACHE = {}
MISSING_COLUMN_THRESHOLD = 0.50
MISSING_ROW_THRESHOLD = 0.50
TYPE_CONVERSION_THRESHOLD = 0.90


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

    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]

    if isinstance(value, np.integer):
        return int(value)

    if isinstance(value, np.bool_):
        return bool(value)

    if isinstance(value, np.floating):
        value = float(value)
        return value if np.isfinite(value) else None

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

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


def _infer_source_metadata(path: str):
    parsed_url = urlparse(path)
    source_path = parsed_url.path if parsed_url.scheme in {"http", "https"} else path
    path_obj = Path(source_path)
    extension = path_obj.suffix.lower() or ".csv"
    stem = path_obj.stem or "dataset"
    return extension, stem


def _save_dataframe(df: pd.DataFrame, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    extension = output_path.suffix.lower()

    if extension == ".csv":
        df.to_csv(output_path, index=False)
        return

    if extension in {".xlsx", ".xls"}:
        df.to_excel(output_path, index=False)
        return

    raise ValueError("Unsupported file format for saving cleaned dataset.")


def _looks_like_datetime_column(column_name: str, values: pd.Series) -> bool:
    name = column_name.lower()
    name_hint = any(token in name for token in ["date", "time", "timestamp", "day", "month", "year"])

    sample = values.dropna().astype(str).head(30)
    if sample.empty:
        return False
    
    normalized = sample.str.strip().str.lower()

    # Guardrail: weekday/month name columns are categorical, not datetime values.
    alpha_only_ratio = float(normalized.str.fullmatch(r"[a-z]+", na=False).mean())
    temporal_words = {
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "mon", "tue", "wed", "thu", "fri", "sat", "sun",
        "january", "february", "march", "april", "may", "june", "july",
        "august", "september", "october", "november", "december",
        "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    }
    temporal_word_ratio = float(normalized.isin(temporal_words).mean())
    if alpha_only_ratio >= 0.90 and temporal_word_ratio >= 0.60:
        return False

    datetime_pattern = (
        r"\d{1,4}[-/]\d{1,2}[-/]\d{1,4}"
        r"|\d{1,2}:\d{2}(?:\:\d{2})?"
        r"|[a-z]{3,9}\s+\d{1,2}(?:,\s*\d{2,4})?"
    )
    pattern_ratio = float(normalized.str.contains(datetime_pattern, regex=True, na=False).mean())

    if pattern_ratio >= 0.50:
        return True

    if name_hint and pattern_ratio >= 0.20:
        return True

    return False


def _build_quality_report(df: pd.DataFrame):
    rows, cols = df.shape
    total_cells = max(rows * cols, 1)

    total_missing = int(df.isna().sum().sum())
    missing_ratio = float(total_missing / total_cells)
    missing_by_column = df.isna().mean()
    high_missing_columns = [
        col for col, ratio in missing_by_column.items() if ratio > MISSING_COLUMN_THRESHOLD
    ]
    completeness_ok = not high_missing_columns and missing_ratio <= 0.05

    string_columns = df.select_dtypes(include=["object", "string"]).columns.tolist()
    inconsistent_category_columns = []
    mixed_case_columns = []
    whitespace_columns = []
    partially_parseable_date_columns = []

    for col in string_columns:
        non_null = df[col].dropna().astype(str)
        if non_null.empty:
            continue

        stripped = non_null.str.strip()
        normalized = stripped.str.lower()

        if (non_null != stripped).any():
            whitespace_columns.append(col)

        if normalized.nunique(dropna=True) < stripped.nunique(dropna=True):
            inconsistent_category_columns.append(col)

        has_upper = stripped.str.contains(r"[A-Z]", regex=True).any()
        has_lower = stripped.str.contains(r"[a-z]", regex=True).any()
        if has_upper and has_lower:
            mixed_case_columns.append(col)

        if _looks_like_datetime_column(col, stripped):
            parsed_dates = pd.to_datetime(stripped, errors="coerce")
            parse_ratio = float(parsed_dates.notna().mean())
            if 0.50 <= parse_ratio < TYPE_CONVERSION_THRESHOLD:
                partially_parseable_date_columns.append(col)

    consistency_ok = not inconsistent_category_columns and not partially_parseable_date_columns
    uniformity_ok = not mixed_case_columns and not whitespace_columns and not partially_parseable_date_columns

    numeric_columns = df.select_dtypes(include="number").columns.tolist()
    impossible_values = {}
    range_violations = {}
    inf_values_total = 0

    for col in numeric_columns:
        series = pd.to_numeric(df[col], errors="coerce")
        inf_count = int(np.isinf(series).sum())
        inf_values_total += inf_count

        col_lower = col.lower()
        invalid_count = 0

        if "age" in col_lower:
            invalid_count += int(((series < 0) | (series > 120)).sum())
            range_violations[col] = int(((series < 0) | (series > 120)).sum())

        if any(token in col_lower for token in ["percent", "percentage", "ratio", "rate"]):
            invalid_count += int(((series < 0) | (series > 100)).sum())
            range_violations[col] = range_violations.get(col, 0) + int(((series < 0) | (series > 100)).sum())

        if any(token in col_lower for token in ["count", "qty", "quantity", "total", "amount"]):
            invalid_count += int((series < 0).sum())

        if invalid_count > 0:
            impossible_values[col] = int(invalid_count)

    exactness_ok = (len(impossible_values) == 0) and inf_values_total == 0
    validity_ok = len({k: v for k, v in range_violations.items() if v > 0}) == 0 and inf_values_total == 0

    duplicate_rows = int(df.duplicated().sum())
    uniqueness_ok = duplicate_rows == 0

    id_columns = [col for col in df.columns if col.lower().endswith("_id")]
    referential_issues = {}
    applied_checks = 0

    for child_col in id_columns:
        base_name = child_col[:-3].strip("_").lower()
        parent_candidates = [
            col
            for col in df.columns
            if col.lower() in {"id", f"{base_name}_id", f"{base_name}id"} and col != child_col
        ]

        if not parent_candidates:
            continue

        parent_col = parent_candidates[0]
        applied_checks += 1

        child_values = set(df[child_col].dropna().astype(str).str.strip().tolist())
        parent_values = set(df[parent_col].dropna().astype(str).str.strip().tolist())
        orphan_count = len(child_values - parent_values)

        if orphan_count > 0:
            referential_issues[child_col] = {
                "parent": parent_col,
                "orphan_keys": orphan_count,
            }

    referential_ok = len(referential_issues) == 0
    referential_applicable = applied_checks > 0

    dimensions = {
        "completitud": completeness_ok,
        "consistencia": consistency_ok,
        "exactitud": exactness_ok,
        "unicidad": uniqueness_ok,
        "validez": validity_ok,
        "integridad_referencial": referential_ok,
        "uniformidad_formato": uniformity_ok,
    }

    is_clean = all(dimensions.values())

    return {
        "is_clean": is_clean,
        "dimensions": dimensions,
        "metrics": {
            "rows": rows,
            "columns": cols,
            "missing_ratio": missing_ratio,
            "total_missing": total_missing,
            "high_missing_columns": high_missing_columns,
            "duplicate_rows": duplicate_rows,
            "inconsistent_categories": inconsistent_category_columns,
            "mixed_case_columns": mixed_case_columns,
            "whitespace_columns": whitespace_columns,
            "partially_parseable_date_columns": partially_parseable_date_columns,
            "impossible_values": impossible_values,
            "range_violations": range_violations,
            "referential_applicable": referential_applicable,
            "referential_issues": referential_issues,
        },
    }


def is_dataset_clean(df: pd.DataFrame):
    return _json_safe(_build_quality_report(df))


def clean_dataset(path: str):
    df = _read_dataframe(path)
    df_cleaned = df.copy()

    quality_before = _build_quality_report(df_cleaned)
    transformations = []

    string_cols = df_cleaned.select_dtypes(include=["object", "string"]).columns.tolist()

    for col in string_cols:
        original_nulls = int(df_cleaned[col].isna().sum())
        df_cleaned[col] = (
            df_cleaned[col]
            .replace(r"^\s*$", pd.NA, regex=True)
            .replace(["NA", "N/A", "null", "None", "none", "nan", "NaN"], pd.NA)
        )
        new_nulls = int(df_cleaned[col].isna().sum())

        if new_nulls > original_nulls:
            transformations.append(
                f"Paso 2: se normalizaron vacios en '{col}' ({new_nulls - original_nulls} valores adicionales tratados como nulos)."
            )

    # Paso 2: eliminar columnas y filas con demasiados nulos
    col_missing_ratio = df_cleaned.isna().mean()
    cols_to_drop = [col for col, ratio in col_missing_ratio.items() if ratio > MISSING_COLUMN_THRESHOLD]
    if cols_to_drop:
        df_cleaned = df_cleaned.drop(columns=cols_to_drop)
        transformations.append(
            f"Paso 2: se eliminaron columnas con >50% de nulos: {', '.join(cols_to_drop)}."
        )

    row_missing_ratio = df_cleaned.isna().mean(axis=1)
    rows_to_drop = int((row_missing_ratio > MISSING_ROW_THRESHOLD).sum())
    if rows_to_drop > 0:
        df_cleaned = df_cleaned.loc[row_missing_ratio <= MISSING_ROW_THRESHOLD].copy()
        transformations.append(
            f"Paso 2: se eliminaron {rows_to_drop} filas con >50% de nulos."
        )

    # Paso 2: imputacion de valores faltantes
    for col in df_cleaned.columns:
        series = df_cleaned[col]
        if not series.isna().any():
            continue

        if pd.api.types.is_numeric_dtype(series):
            median_value = series.median()
            df_cleaned[col] = series.fillna(median_value.__round__(3))
            transformations.append(f"Paso 2: imputacion de '{col}' con mediana ({median_value}).")
            continue

        mode_series = series.mode(dropna=True)
        fill_value = mode_series.iloc[0] if not mode_series.empty else "unknown"
        df_cleaned[col] = series.fillna(fill_value)
        transformations.append(f"Paso 2: imputacion de '{col}' con moda/categoria ({fill_value}).")

    # Paso 3: eliminar duplicados
    duplicate_count = int(df_cleaned.duplicated().sum())
    if duplicate_count > 0:
        df_cleaned = df_cleaned.drop_duplicates().copy()
        transformations.append(f"Paso 3: se eliminaron {duplicate_count} filas duplicadas.")

    # Paso 4: corregir tipos de datos
    for col in df_cleaned.columns:
        series = df_cleaned[col]
        if not pd.api.types.is_object_dtype(series) and not pd.api.types.is_string_dtype(series):
            continue

        non_null = series.dropna().astype(str).str.strip()
        if non_null.empty:
            continue

        # Agregar porcentajes como candidatos a numéricos
        if non_null.str.endswith("%").any():
            percentage_candidate = non_null.str.rstrip("%").replace("", pd.NA)
            percentage_numeric = pd.to_numeric(percentage_candidate, errors="coerce")
            percentage_ratio = float(percentage_numeric.notna().mean())
            if percentage_ratio >= TYPE_CONVERSION_THRESHOLD:
                df_cleaned[col] = percentage_numeric / 100
                transformations.append(f"Paso 4: '{col}' convertido a porcentaje numerico.")
                continue

        numeric_candidate = pd.to_numeric(non_null, errors="coerce")
        numeric_ratio = float(numeric_candidate.notna().mean())
        print(f"Columna '{col}': ratio de parseo numerico = {numeric_ratio:.2f}")
        print(f"Valores originales: {non_null.head(5).tolist()}")
        print(f"Valores parseados: {numeric_candidate.head(5).tolist()}")

        if numeric_ratio >= TYPE_CONVERSION_THRESHOLD:
            print(f"Columna '{col}' convertida a numerico.")
            df_cleaned[col] = pd.to_numeric(df_cleaned[col], errors="coerce")
            transformations.append(f"Paso 4: '{col}' convertido a numerico.")
            continue

        if _looks_like_datetime_column(col, non_null):
            date_candidate = pd.to_datetime(non_null, errors="coerce")
            date_ratio = float(date_candidate.notna().mean())
            if date_ratio >= TYPE_CONVERSION_THRESHOLD:
                df_cleaned[col] = pd.to_datetime(df_cleaned[col], errors="coerce").dt.strftime("%Y-%m-%d")
                transformations.append(f"Paso 4: '{col}' convertido a fecha (YYYY-MM-DD).")

    # Paso 5: estandarizar formatos y valores de texto
    for col in df_cleaned.select_dtypes(include=["object", "string"]).columns:
        normalized = df_cleaned[col].astype("string")
        normalized = normalized.str.strip().str.lower()
        normalized = normalized.replace("", pd.NA)
        df_cleaned[col] = normalized
        transformations.append(f"Paso 5: estandarizacion de formato en '{col}' (strip + lower).")

    # Paso 6: tratar outliers con IQR clipping
    for col in df_cleaned.select_dtypes(include="number").columns:
        series = pd.to_numeric(df_cleaned[col], errors="coerce")
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1

        if pd.isna(iqr) or iqr == 0:
            continue

        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        clipped = series.clip(lower=lower, upper=upper)
        affected = int((series != clipped).sum())

        if affected > 0:
            df_cleaned[col] = clipped
            # Volver a eliminar duplicados que puedan haber surgido por el tratamiento de outliers
            df_cleaned = df_cleaned.drop_duplicates().copy()
            transformations.append(
                f"Paso 6: {affected} outliers tratados en '{col}' por winsorizacion IQR."
            )

    # Paso 7: validar rangos/dominios con reglas heuristicas por nombre de columna
    for col in df_cleaned.select_dtypes(include="number").columns:
        col_lower = col.lower()
        series = pd.to_numeric(df_cleaned[col], errors="coerce")

        if "age" in col_lower:
            before = series.copy()
            series = series.clip(lower=0, upper=120)
            corrected = int((before != series).sum())
            if corrected > 0:
                transformations.append(f"Paso 7: '{col}' ajustado al rango [0,120].")

        if any(token in col_lower for token in ["percent", "percentage", "ratio", "rate"]):
            before = series.copy()
            series = series.clip(lower=0, upper=100)
            corrected = int((before != series).sum())
            if corrected > 0:
                transformations.append(f"Paso 7: '{col}' ajustado al rango [0,100].")

        if any(token in col_lower for token in ["count", "qty", "quantity", "total", "amount"]):
            before = series.copy()
            series = series.clip(lower=0)
            corrected = int((before != series).sum())
            if corrected > 0:
                transformations.append(f"Paso 7: '{col}' ajustado para evitar valores negativos.")

        df_cleaned[col] = series

    # Paso 8: verificacion de integridad referencial en un solo dataframe
    id_columns = [col for col in df_cleaned.columns if col.lower().endswith("_id")]

    for child_col in id_columns:
        base_name = child_col[:-3].strip("_").lower()
        parent_candidates = [
            col
            for col in df_cleaned.columns
            if col.lower() in {"id", f"{base_name}_id", f"{base_name}id"} and col != child_col
        ]

        if not parent_candidates:
            continue

        parent_col = parent_candidates[0]
        parent_values = set(df_cleaned[parent_col].dropna().astype(str).str.strip().tolist())
        child_values = df_cleaned[child_col].astype(str).str.strip()
        orphan_mask = df_cleaned[child_col].notna() & ~child_values.isin(parent_values)
        orphan_count = int(orphan_mask.sum())

        if orphan_count > 0:
            df_cleaned = df_cleaned.loc[~orphan_mask].copy()
            transformations.append(
                f"Paso 8: se eliminaron {orphan_count} registros huerfanos de '{child_col}' sin referencia en '{parent_col}'."
            )

    quality_after = _build_quality_report(df_cleaned)

    # Paso 9: guardar el resultado limpio sin sobreescribir el original
    extension, stem = _infer_source_metadata(path)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    output_dir = Path("tmp") / "cleaned"
    output_file = output_dir / f"{stem}_cleaned_{timestamp}{extension}"
    _save_dataframe(df_cleaned, output_file)

    eda = {
        "shape": {
            "rows": int(df.shape[0]),
            "columns": int(df.shape[1]),
        },
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "preview": df.head(5).to_dict(orient="records"),
        "describe": df.describe(include="all").to_dict(),
    }

    return _json_safe(
        {
            "quality_before": quality_before,
            "quality_after": quality_after,
            "eda": eda,
            "transformations": transformations,
            "cleaned_path": str(output_file),
            "original_shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
            "cleaned_shape": {"rows": int(df_cleaned.shape[0]), "columns": int(df_cleaned.shape[1])},
            "cleaned_preview": df_cleaned.head(6).to_dict(orient="records"),
        }
    )
