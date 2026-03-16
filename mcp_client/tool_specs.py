tools = [

    {
        "type": "function",
        "function": {
            "name": "describe_dataset",
            "description": "Return dataset structure and descriptive statistics of every column, including number of rows, columns, summary statistics for numeric and categorical variables, missing values, and top correlations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                },
                "required": ["url"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "query_dataset",
            "description": "Perform tabular queries over the dataset including filtering, grouping, aggregations, sorting and limiting results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "select": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "filters": {
                        "type": "object",
                        "additionalProperties": {"type": "string"}
                    },
                    "groupby": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "aggregations": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "string",
                            "enum": ["mean","sum","max","min","count"]
                        }
                    },
                    "sort_by": {"type": "string"},
                    "sort_order": {
                        "type": "string",
                        "enum": ["asc","desc"]
                    },
                    "limit": {"type": "integer"}
                },
                "required": ["url"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "generate_chart",
            "description": "Generate chart-ready data for a given chart type and its parameters.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "chart_type": {
                        "type": "string",
                        "enum": ["bar", "scatter", "histogram"]
                    },
                    "x": {"type": "string"},
                    "y": {"type": "string"},
                    "aggregation": {
                        "type": "string",
                        "enum": ["mean","sum","max","min","count"]
                    },
                    "bins": {"type": "integer"}
                },
                "required": ["url", "chart_type", "x", "bins"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "detect_outliers",
            "description": "Detect outliers in a numeric column",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "column": {"type": "string"}
                },
                "required": ["url", "column"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "compute_correlation",
            "description": "Compute correlations between numeric variables in the dataset to identify relationships between features.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL of the dataset to analyze"
                    },
                    "target": {
                        "type": "string",
                        "description": "Optional target column to compute correlations against"
                    },
                    "method": {
                        "type": "string",
                        "enum": ["pearson", "spearman", "kendall"],
                        "description": "Correlation method"
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of strongest correlations to return",
                        "default": 10
                    }
                },
                    "required": ["url"]
            }
        }
    },

    {
        "type": "function",
            "function": {
            "name": "generate_insights",
            "description": "Automatically analyze the dataset and return important statistical insights such as strong correlations, dominant categories, skewed distributions, and missing values.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL of the dataset to analyze"
                    },
                    "corr_threshold": {
                        "type": "number",
                        "description": "Minimum absolute correlation to report",
                        "default": 0.7
                    },
                    "dominance_threshold": {
                        "type": "number",
                        "description": "Minimum proportion for a dominant category",
                        "default": 0.6
                    },
                    "missing_threshold": {
                        "type": "number",
                        "description": "Minimum ratio of missing values to report",
                        "default": 0.1
                    }
                },
                "required": ["url"]
            }
        }
    }

]