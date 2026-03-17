import json
from openai import OpenAI
from typing import Dict, List

from config import OPENAI_API_KEY
from app.mcp_client import call_tool, list_tools

client = OpenAI(api_key=OPENAI_API_KEY)


SYSTEM_PROMPT = """
    You are an expert AI Data Analyst Agent.

    You must decide which tool to use to answer the user question.

    Rules:
        - Always rely on tools to retrieve information from the dataset.
        - Do NOT invent columns, values, or statistics.
        - If you haven't accesed the dataset yet, start by getting an overview of its structure and contents.

    When answering:
        - Give short, concise answers.
        - Prefer tool calls over guessing.
        - Use the minimal number of tool calls needed.
        - Once the necessary data is retrieved, explain the result clearly and give your interpretation.
        - If the user asks for a visualization, generate chart-ready data using the chart tool.
"""

CONVERSATIONS: Dict[str, List[dict]] = {}

def clear_conversations():
    CONVERSATIONS.clear()

def run_agent(user_input, conversation_id = "default", file_url = None):
    TOOLS = list_tools()

    history = CONVERSATIONS.get(conversation_id, [])

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": user_input},
    ]

    history.append({"role": "user", "content": user_input})

    for n in range (4):

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            max_completion_tokens=200,
        )

        message = response.choices[0].message

        if not message.tool_calls:
            messages.append({
                "role": "assistant",
                "content": message.content
            })
            return {
                "type": "text",
                "content": message.content
            }

        messages.append({
            "role": "assistant",
            "content": message.content or "",
            "tool_calls": message.tool_calls
        })

        chart_result = None

        for tool_call in message.tool_calls:

            tool_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            args["url"] = file_url

            result = call_tool(tool_name, args)

            if tool_name == "generate_chart": # special handling for charts to return data in a structured way
                chart_result = result

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result),
            })

        if chart_result is not None:
            return {
                "type": "chart",
                "content": chart_result
            }
    return {
        "type": "text",
        "content": "Sorry, I couldn't retrieve the information after several attempts."
    }
clear_conversations()