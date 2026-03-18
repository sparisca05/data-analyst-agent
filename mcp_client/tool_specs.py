tools = [

    {
        "type": "function",
        "function": {
            "name": "describe_dataset",
            "description": """Return basic structural information about the dataset.
                This includes metadata only, not analytical insights.
                Use this tool when you need to understand the dataset's structure, columns, types, size, or general overview.
                If the user asks for dataset summary, description, or structure, use this tool and respond with a concise overview telling about the dataset, not column listing.
                Do NOT use this tool for patterns, relationships, or insights.
            """,
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
            "description": """Query the dataset using filtering, grouping and aggregations. Do not use SQL expressions.
                Examples:

                User: average BMI by Gender
                Tool call:
                groupby: [\"Gender\"]
                aggregations: {\"BMI\": \"mean\"}

                User: total revenue by region
                Tool call:
                groupby: [\"region\"]
                aggregations: {\"revenue\": \"sum\"}

                User: number of customers by country
                Tool call:
                groupby: [\"country\"]
                aggregations: {\"customer_id\": \"count\"}

                Important: This tool does not use SQL syntax.
                Aggregations must be specified using the 'aggregations' parameter.
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "select": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of columns to include in the result. Only column names are allowed. Do not use SQL expressions like AVG() or SUM()."
                    },
                    "filters": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": "Filter rows by column value. Example: {\"country\": \"USA\"}"
                    },
                    "groupby": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Columns used to group the data before applying aggregations. Example: [\"Gender\"]."
                    },
                    "aggregations": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "string",
                            "enum": ["mean","sum","max","min","count"],
                        },
                        "description": "Aggregation to apply to numeric columns. Format: {\"column_name\": \"aggregation_function\"}. Example: {\"BMI\": \"mean\"}. When the user asks for averages, totals, counts, etc., this parameter must be used together with groupby."
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
            "description": """Create a visual chart from dataset columns.
                MUST be used whenever the user asks to visualize, plot, graph, chart, or see distributions or relationships between variables.
                Do NOT use for textual summaries or dataset descriptions.
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "chart_type": {
                        "type": "string",
                        "enum": ["bar", "scatter", "histogram", "line", "doughnut", "pie"],
                        "description": """Type of chart to generate.
                            If the user doesn't specify a chart type:
                            Use 'bar' for categorical comparisons,
                            'scatter' for relationships between two numeric variables,
                            'histogram' for distributions of a single numeric variable,
                            'line' for trends over an ordered variable (like time),
                            'doughnut' for proportions of a categorical variable,
                            and 'pie' for similar purposes.
                        """
                    },
                    "x": {
                        "type": "string",
                        "description": "Column name for x-axis. For scatter plots, this is the first variable."
                    },
                    "y": {
                        "type": "string",
                        "description": "Column name for y-axis. For scatter plots, this is the second variable."
                    },
                    "aggregation": {
                        "type": "string",
                        "enum": ["mean","sum","max","min","count"],
                        "description": "Aggregation function when grouping is applied. Required if groupby is present."
                    }
                },
                "required": ["url", "chart_type", "x"]
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
            "description": """Analyze the dataset and return important insights, patterns, and statistical findings.
                This includes correlations, dominant categories, skewed distributions, missing values, and other meaningful patterns.
                Use this tool when the user asks for insights, patterns, trends, or important findings in the data.
                Do NOT use this tool for simple dataset description.
            """,
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