import os
from typing import Optional
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
from app.agent import clear_conversations, run_agent
from app.tools import load_dataset

app = FastAPI()

# Enable CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
    path = f"datasets/{file.filename}"
    os.makedirs("datasets", exist_ok=True)

    with open(path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    load_result = load_dataset(path=path, conversation_id=conversation_id)
    clear_conversations()

    return {"status": "dataset loaded", "dataset": load_result}


class ChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = "default"

@app.post("/chat")
async def chat(payload: ChatRequest):

    result = run_agent(payload.query, conversation_id=payload.conversation_id or "default")

    return {"response": result, "conversation_id": payload.conversation_id or "default"}
