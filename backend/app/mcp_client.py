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
        }
    )
    return r.json()["result"]