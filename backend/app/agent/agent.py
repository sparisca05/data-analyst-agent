import json
from openai import OpenAI
from typing import Dict, List

from app.tools import dataset_schema, describe_dataset, generate_chart_data, groupby_analysis
from app.agent.tool_specs import tools
from app.agent.tool_registry import TOOL_REGISTRY
from config import OPENAI_API_KEY

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
"""

CONVERSATIONS: Dict[str, List[dict]] = {}

def clear_conversations():
    CONVERSATIONS.clear()

def run_agent(user_input, conversation_id = "default"):

    history = CONVERSATIONS.get(conversation_id, [])

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current conversation ID: {conversation_id}"},
        *history,
        {"role": "user", "content": user_input},
    ]

    history.append({"role": "user", "content": user_input})

    while True:

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
            max_completion_tokens=200,
        )

        message = response.choices[0].message

        if not message.tool_calls:
            messages.append(message)
            return message.content

        # el modelo quiere usar tools
        for tool_call in message.tool_calls:

            tool_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)

            tool_function = TOOL_REGISTRY[tool_name]

            result = tool_function(**args)

            messages.append(message)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result)
            })