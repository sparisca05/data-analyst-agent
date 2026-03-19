import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np

from tool_registry import TOOLS
from tool_specs import tools

app = FastAPI()

front_url = os.getenv("FRONT_URL")
allowed_origins = ["http://localhost:5173", "http://localhost:3000"]
if front_url:
    allowed_origins.append(front_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/")
def root():
    return {"message": "Hello from the tool server!"}

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
