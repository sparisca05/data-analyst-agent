import os
import shutil
from uuid import uuid4
from pathlib import Path
from supabase import create_client
from typing import Optional
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agent import clear_conversations, run_agent
from app.utils import load_dataset, set_file_url, get_file_url, clean_dataset

from config import SUPABASE_URL, SUPABASE_KEY, FRONT_URL

app = FastAPI()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
SAMPLE_DATASET_URL = os.getenv(
    "SAMPLE_DATASET_URL",
    "https://jffveitzaqlqrpypjtov.supabase.co/storage/v1/object/public/datasets/sample.csv",
)


# Enable CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", FRONT_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _upload_cleaned_dataset(local_path: str, conversation_id: str):
    file_name = Path(local_path).name
    storage_path = f"{conversation_id}_{uuid4().hex}_{file_name}"

    with open(local_path, "rb") as dataset_file:
        supabase.storage.from_("datasets").upload(storage_path, dataset_file.read())

    return supabase.storage.from_("datasets").get_public_url(storage_path)

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

    clean_report = clean_dataset(path=path)
    cleaned_path = clean_report["cleaned_path"]
    load_result = load_dataset(path=cleaned_path)
    clear_conversations()

    try:
        file_url = _upload_cleaned_dataset(cleaned_path, conversation_id)
        set_file_url(conversation_id=conversation_id, url=file_url)
    except Exception as e:
        print(f"Error uploading file to Supabase: {e}")
        return {"status": "error uploading file"}

    return {
        "status": "dataset loaded and cleaned",
        "dataset": load_result,
        "cleaning": clean_report,
    }


@app.post("/load-sample")
def load_sample_dataset_endpoint(
    conversation_id: Optional[str] = "default",
    file_url: Optional[str] = None,
):
    """Load a public sample dataset URL and bind it to a conversation."""

    resolved_file_url = (file_url or SAMPLE_DATASET_URL).strip()
    print("Cleaning dataset...")
    clean_report = clean_dataset(path=resolved_file_url)
    cleaned_path = clean_report["cleaned_path"]
    load_result = load_dataset(path=cleaned_path)
    clear_conversations()

    try:
        cleaned_file_url = "https://jffveitzaqlqrpypjtov.supabase.co/storage/v1/object/public/datasets/sample-cleaned.csv"
        set_file_url(conversation_id=conversation_id, url=cleaned_file_url)
    except Exception as e:
        print(f"Error uploading cleaned sample file to Supabase: {e}")
        return {"status": "error uploading sample file"}

    return {
        "status": "sample dataset loaded and cleaned",
        "dataset": load_result,
        "file_url": cleaned_file_url,
        "cleaning": clean_report,
    }


class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = "default"

@app.post("/chat")
async def chat(payload: ChatRequest):
    file_url = get_file_url(conversation_id=payload.conversation_id)
    result = run_agent(payload.query, conversation_id=payload.conversation_id, file_url=file_url)

    return {"response": result, "conversation_id": payload.conversation_id}
