import os
from dotenv import load_dotenv
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
MCP_URL = os.getenv("MCP_URL", "http://localhost:8001")
FRONT_URL = os.getenv("FRONT_URL", "http://localhost:5173")