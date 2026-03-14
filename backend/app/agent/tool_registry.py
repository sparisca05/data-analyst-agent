from app.tools import (
    describe_dataset,
    groupby_analysis,
    detect_outliers,
    generate_chart_data
)

TOOL_REGISTRY = {

    "describe_dataset": describe_dataset,
    "groupby_analysis": groupby_analysis,
    "detect_outliers": detect_outliers,
    "generate_chart_data": generate_chart_data

}