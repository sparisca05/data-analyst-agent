import requests
from config import MCP_URL


def list_tools():
    r = requests.get(f"{MCP_URL}/tools")
    return r.json()

def call_tool(tool, arguments):
    try:
        r = requests.post(
            f"{MCP_URL}/call",
            json={
                "tool": tool,
                "arguments": arguments
            },
            timeout=30
        )
    except requests.RequestException as e:
        return {"error": f"MCP request failed: {str(e)}"}

    ct = r.headers.get("content-type", "")
    if "application/json" not in ct.lower():
        return {
            "error": f"MCP returned non-JSON response (status={r.status_code}, content-type={ct}): {r.text[:500]}"
        }

    try:
        data = r.json()
    except ValueError:
        return {"error": f"MCP returned invalid JSON: {r.text[:500]}"}

    if "error" in data:
        return {"error": data["error"]}

    if "result" not in data:
        return {"error": f"Missing result in MCP response: {data}"}

    return data["result"]