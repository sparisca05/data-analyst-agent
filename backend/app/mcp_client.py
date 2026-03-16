import requests
from config import MCP_URL


def list_tools():
    r = requests.get(f"{MCP_URL}/tools")
    return r.json()

def call_tool(tool, arguments):
    r = requests.post(
        f"{MCP_URL}/call",
        json={
            "tool": tool,
            "arguments": arguments
        },
        timeout=30
    )
    
    ct = r.headers.get("content-type", "")
    if "application/json" not in ct.lower():
        raise RuntimeError(f"Unexpected content-type {ct}: {r.text[:500]}")

    data = r.json()
    if "result" not in data:
        raise RuntimeError(f"Missing result in response: {data}")
    
    return data["result"]