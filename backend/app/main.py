import os
import shutil
from supabase import create_client
from typing import Optional
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agent import clear_conversations, run_agent
from app.utils import load_dataset, set_file_url, get_file_url

from config import SUPABASE_URL, SUPABASE_KEY, FRONT_URL

app = FastAPI()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# Enable CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", FRONT_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Hello from FastAPI!", "status": "ok"}

@app.post("/upload")
def upload_file_endpoint(file: UploadFile, conversation_id: Optional[str] = "default"):
    """Upload a file and process its content"""

    path = f"tmp/{file.filename}"
    os.makedirs("tmp", exist_ok=True)

    with open(path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    load_result = load_dataset(path=path)
    clear_conversations()

    try:
        storage_path = f"{conversation_id}_{file.filename}"
        with open(path, "rb") as dataset_file:
            supabase.storage.from_("datasets").upload(storage_path, dataset_file.read())
            file_url = supabase.storage.from_("datasets").get_public_url(storage_path)
            set_file_url(conversation_id=conversation_id, url=file_url)
    except Exception as e:
        print(f"Error uploading file to Supabase: {e}")
        return {"status": "error uploading file"}

    return {"status": "dataset loaded", "dataset": load_result}


class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = "default"

@app.post("/chat")
async def chat(payload: ChatRequest):
    file_url = get_file_url(conversation_id=payload.conversation_id)
    result = run_agent(payload.query, conversation_id=payload.conversation_id, file_url=file_url)

    return {"response": result, "conversation_id": payload.conversation_id}
