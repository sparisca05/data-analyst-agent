tools = [

    {
        "type": "function",
        "function": {
            "name": "describe_dataset",
            "description": "Return descriptive statistics of numeric columns",
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
            "name": "groupby_analysis",
            "description": "Aggregate a metric grouped by a column",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "group_by": {"type": "string"},
                    "metric": {"type": "string"},
                    "aggregation": {
                        "type": "string",
                        "enum": ["mean","sum","max","min","count"]
                    }
                },
                "required": ["url","group_by","metric","aggregation"]
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
            "name": "generate_chart_data",
            "description": "Generate data for a chart",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "chart_type": {
                        "type": "string",
                        "enum": ["histogram","bar"]
                    },
                    "column": {"type": "string"}
                },
                "required": ["url", "chart_type","column"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "dataset_schema",
            "description": "Returns the dataset schema, including column names and data types",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                },
                "required": ["url"]
            }
        }
    }

]