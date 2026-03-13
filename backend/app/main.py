import os
from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import shutil
from app.agent import run_agent

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
def upload_file_endpoint(file: UploadFile):
    """Upload a file and process its content"""
    path = f"datasets/{file.filename}"

    with open(path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    run_agent(f'Load dataset from path "{path}"')

    return {"status": "dataset loaded"}


@app.post("/chat")
async def chat(query: str):

    result = run_agent(query)

    return {"response": result}
