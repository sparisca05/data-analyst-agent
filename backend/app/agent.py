from openai import OpenAI
import json
import os

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

    Return tool calls in JSON:
    {
        "tool": "...",
        "args": {...}
    }
"""

def run_agent(user_input):

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input}
        ]
    )

    message = response.choices[0].message.content

    try:
        action = json.loads(message)
    except:
        return message

    tool = action["tool"]
    args = action.get("args", {})
    
    if tool == "load_dataset":
        return load_dataset(**args)
    elif tool == "describe_dataset":
        return describe_dataset()
    else:
        return "Tool not supported"