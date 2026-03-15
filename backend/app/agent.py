import json
from openai import OpenAI
from typing import Dict, List

from config import OPENAI_API_KEY
from app.mcp_client import call_tool, list_tools

client = OpenAI(api_key=OPENAI_API_KEY)


SYSTEM_PROMPT = """
    You are a data analyst agent.

    You must decide which tool to use to answer the user question.

    Rules:
        - Always rely on tools to retrieve information from the dataset.
        - Do NOT invent columns, values, or statistics.
        - If a question requires computation or aggregation, call the appropriate tool.
        - If you do not know the dataset schema yet, call the tool that provides the dataset structure.
        - When possible, return structured insights that can be visualized in charts.
    
    Available capabilities include:
        - Descriptive statistics
        - Grouped aggregations
        - Outlier detection
        - Generating data structures for charts

    When answering:
        - Give short, concise answers.
        - Prefer tool calls over guessing.
        - Use the minimal number of tool calls needed.
        - Once the necessary data is retrieved, explain the result clearly.
        - If the user asks for a visualization, generate chart-ready data using the chart tool.
    
    ONLY RETRIEVE THE FINAL ANSWER AFTER CALLING THE TOOLS NEEDED TO CONFIRM THE DATA INSIGHTS.
"""

CONVERSATIONS: Dict[str, List[dict]] = {}

def clear_conversations():
    CONVERSATIONS.clear()

def run_agent(user_input, conversation_id = "default", file_url = None):
    TOOLS = list_tools()
    tool_called = False

    history = CONVERSATIONS.get(conversation_id, [])

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": user_input},
    ]

    history.append({"role": "user", "content": user_input})

    for n in range (8):

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            max_completion_tokens=200,
        )

        message = response.choices[0].message
        print("Agent response:", message)

        if not message.tool_calls:
            if not tool_called:
                messages.append({
                    "role": "assistant",
                    "content": message.content
                })
                continue
            return message.content

        tool_called = True

        for tool_call in message.tool_calls:

            tool_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            args["url"] = file_url

            messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": message.tool_calls
            })

            result = call_tool(tool_name, args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result),
            })

clear_conversations()