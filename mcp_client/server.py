from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np

from tool_registry import TOOLS
from tool_specs import tools

app = FastAPI()

class ToolRequest(BaseModel):
    tool: str
    arguments: dict


def to_json_safe(value):
    if isinstance(value, dict):
        return {k: to_json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [to_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return [to_json_safe(v) for v in value.tolist()]
    if isinstance(value, np.generic):
        return value.item()
    return value

@app.get("/tools")
def list_tools():
    return tools

@app.post("/call")
def call_tool(req: ToolRequest):
    if req.tool not in TOOLS:
        return {"error": "tool not found"}

    try:    
        fn = TOOLS[req.tool]
        result = fn(**req.arguments)
        return {"result": to_json_safe(result)}
    except Exception as e:
        return {"error": str(e)}
