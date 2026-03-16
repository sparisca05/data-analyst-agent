from fastapi import FastAPI
from pydantic import BaseModel

from tool_registry import TOOLS
from tool_specs import tools

app = FastAPI()

class ToolRequest(BaseModel):
    tool: str
    arguments: dict

@app.get("/tools")
def list_tools():
    return tools

@app.post("/call")
def call_tool(req: ToolRequest):
    print(TOOLS.keys())
    if req.tool not in TOOLS:
        return {"error": "tool not found"}

    try:    
        fn = TOOLS[req.tool]
        result = fn(**req.arguments)
        return { "result": result }
    except Exception as e:
        return {"error": str(e)}
