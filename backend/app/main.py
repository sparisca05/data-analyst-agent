import os
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from repositories.job_repository import create_job, get_job, get_jobs_by_user
from repositories.proposal_repository import create_proposal, get_proposals_for_user
from repositories.profile_repository import get_profile, update_profile
from schemas.job import JobRequest
from schemas.proposal import ProposalRequest
from schemas.profile import ProfileRequest
from services.ai_service import generate_proposal
from db.database import get_db
from core.auth import get_current_user
from core.config import DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY

if not DATABASE_URL:
    raise ValueError("DATABASE_URL not set in environment variables")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise ValueError("Supabase environment variables not set")

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

@app.get("/jobs")
def get_jobs_endpoint(user_id: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all job postings for the authenticated user"""
    jobs = get_jobs_by_user(db, user_id)
    return {"jobs": jobs}

@app.post("/save_job")
def save_job(
    request: JobRequest,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save a new job posting for the authenticated user"""
    
    job = create_job(db, user_id, request.title, request.description)
    return {
        "job_id": str(job.id),
        "message": "Job saved successfully"
    }
    
@app.post("/generate")
def generate_proposal_endpoint(
    request: ProposalRequest,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_profile = get_profile(db, user_id)
    job = get_job(db, request.job_id)

    response = generate_proposal(user_profile, job.description)

    proposal = create_proposal(
        db,
        user_id,
        request.job_id,
        response['proposal_text'],
        response['timeline_estimate'],
        response['questions'],
        response['job_analysis']['difficulty_level'],
        response['job_analysis']['match_score'],
        response['job_analysis']['key_skills'],
        response['job_analysis']['estimated_budget_range']
    )

    return {
        "id": str(proposal.id),
        "job_id": str(proposal.job_id),
        "title": job.title,
        "proposal_text": response['proposal_text'],
        "timeline_estimate": response['timeline_estimate'],
        "questions": response['questions'],
        "difficulty_level": response['job_analysis']['difficulty_level'],
        "match_score": response['job_analysis']['match_score'],
        "key_skills": response['job_analysis']['key_skills'],
        "estimated_budget_range": response['job_analysis']['estimated_budget_range']
    }
@app.get("/proposals")
def get_proposals(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Get proposals for the authenticated user from the database"""
    try:
        proposals = get_proposals_for_user(db, user)
        
        return {
            "proposals": proposals
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
@app.post("/update_profile")
def update_profile_endpoint(
    request: ProfileRequest,
    user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user profile information"""
    update_profile(
        db,
        user,
        request.full_name,
        request.headline,
        request.years_experience,
        request.primary_role,
        request.skills,
        request.bio
    )
    return {"message": "Profile updated successfully"}