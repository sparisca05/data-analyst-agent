from openai import OpenAI
from typing import Dict, List
import json

from app.tools import describe_dataset, load_dataset
from config import OPENAI_API_KEY

client = OpenAI(api_key=OPENAI_API_KEY)


SYSTEM_PROMPT = """
    You are a data analyst agent.

    You must decide which tool to use to answer the user question.

    Available tools:
    - load_dataset(path)
    - describe_dataset()

    Always use tools when calculations are needed.

    If a tool is needed, respond only with a JSON:
    {
        "tool": "...",
        "args": {...}
    }
"""

CONVERSATIONS: Dict[str, List[dict]] = {}

def clear_conversations():
    CONVERSATIONS.clear()

def run_agent(user_input, conversation_id = "default"):

    history = CONVERSATIONS.get(conversation_id, [])
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": user_input},
    ]

    history.append({"role": "user", "content": user_input})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )

    message = response.choices[0].message.content

    # Verify if the message is a tool call, if not, return the message as response
    try:
        action = json.loads(message)
    except json.JSONDecodeError:
        history.append({"role": "assistant", "content": message})
        CONVERSATIONS[conversation_id] = history
        return message

    tool = action["tool"]
    args = action.get("args", {})
    
    if tool in ("load_dataset", "describe_dataset"):
        args["conversation_id"] = conversation_id

    if tool == "load_dataset":
        tool_result = load_dataset(**args)
    elif tool == "describe_dataset":
        tool_result = describe_dataset(**args)
    else:
        tool_result = "Tool not supported"

    history.append(
        {
            "role": "assistant",
            "content": f"Tool result: {json.dumps(tool_result, ensure_ascii=True)}",
        }
    )
    CONVERSATIONS[conversation_id] = history

    return tool_result