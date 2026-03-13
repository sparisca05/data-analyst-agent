import os
from dotenv import load_dotenv
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
FRONT_URL = os.getenv("FRONT_URL", "http://localhost:5173")