tools = [

    {
        "type": "function",
        "function": {
            "name": "describe_dataset",
            "description": "Return descriptive statistics of numeric columns",
            "parameters": {
                "type": "object",
                "properties": {
                    "conversation_id": {"type": "string"}
                },
                "required": ["conversation_id"]
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
                    "conversation_id": {"type": "string"},
                    "group_by": {"type": "string"},
                    "metric": {"type": "string"},
                    "aggregation": {
                        "type": "string",
                        "enum": ["mean","sum","max","min","count"]
                    }
                },
                "required": ["conversation_id","group_by","metric","aggregation"]
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
                    "conversation_id": {"type": "string"},
                    "column": {"type": "string"}
                },
                "required": ["conversation_id", "column"]
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
                    "chart_type": {
                        "type": "string",
                        "enum": ["histogram","bar"]
                    },
                    "conversation_id": {"type": "string"},
                    "column": {"type": "string"}
                },
                "required": ["conversation_id", "chart_type","column"]
            }
        }
    }

]