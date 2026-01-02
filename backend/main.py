import os
import json
import datetime
import io
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import pypdf
from PIL import Image 

from google import genai
from google.genai import types

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# --- 1. DATABASE SETUP ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./study.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class StudyLog(Base):
    __tablename__ = "study_logs"
    id = Column(Integer, primary_key=True, index=True)
    topic = Column(String)
    duration_minutes = Column(Integer)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    xp_earned = Column(Integer)

class UserStats(Base):
    __tablename__ = "user_stats"
    id = Column(Integer, primary_key=True)
    total_xp = Column(Integer, default=0)

class PlannedTask(Base):
    __tablename__ = "planned_tasks"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, index=True) 
    time = Column(String)
    task = Column(String)
    type = Column(String)
    reason = Column(String, nullable=True) # NEW
    key_concepts = Column(String, nullable=True) # NEW (Stored as JSON String)
    suggested_resources = Column(String, nullable=True) # NEW (Stored as JSON String)
    completed = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        if not db.query(UserStats).first():
            db.add(UserStats(total_xp=0))
            db.commit()
        yield db
    finally:
        db.close()

app = FastAPI(title="Cerebra Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. DATA MODELS ---

class ScheduleRequest(BaseModel):
    energy_level: str
    hours_available: int
    subjects: List[str]
    current_time: str
    date: str 

class LogRequest(BaseModel):
    topic: str
    duration: int
    xp: int 

class TaskCreate(BaseModel):
    date: str
    time: str 
    task: str
    type: str
    reason: Optional[str] = ""
    key_concepts: List[str] = []
    suggested_resources: List[str] = []

class TaskUpdate(BaseModel):
    task: str
    time: str

class QuizRequest(BaseModel):
    topic: str

# --- 3. AI ENDPOINTS ---

def get_best_model():
    return "gemini-flash-latest"

@app.post("/analyze-syllabus")
async def analyze_syllabus(file: UploadFile = File(...)):
    content = await file.read()
    mime_type = file.content_type
    
    prompt_text = "Analyze this syllabus. Return STRICT JSON: { \"syllabus\": [ { \"module\": \"Name\", \"subtopics\": [\"Sub 1\"] } ] }"

    try:
        response = None
        if "pdf" in mime_type:
            pdf_reader = pypdf.PdfReader(io.BytesIO(content))
            raw_text = ""
            for page in pdf_reader.pages: raw_text += page.extract_text() + "\n"
            response = client.models.generate_content(model=get_best_model(), contents=f"{prompt_text}\n\nTEXT:\n{raw_text[:8000]}", config=types.GenerateContentConfig(response_mime_type="application/json"))
        elif "image" in mime_type:
            image = Image.open(io.BytesIO(content))
            response = client.models.generate_content(model=get_best_model(), contents=[prompt_text, image], config=types.GenerateContentConfig(response_mime_type="application/json"))
        elif "text" in mime_type:
            text_content = content.decode("utf-8")
            response = client.models.generate_content(model=get_best_model(), contents=f"{prompt_text}\n\nTEXT:\n{text_content[:8000]}", config=types.GenerateContentConfig(response_mime_type="application/json"))
        else: return {"error": "Unsupported file"}

        data = json.loads(response.text)
        formatted_topics = []
        for item in data.get("syllabus", []):
            module = item.get("module", "Topic")
            subs = ", ".join(item.get("subtopics", []))
            formatted_topics.append(f"{module} ({subs})")
        return {"topics": formatted_topics}
    except Exception as e: return {"topics": [], "error": str(e)}

@app.post("/generate-plan")
def generate_plan(state: ScheduleRequest):
    style = "balanced"
    if state.energy_level == "Low": style = "Passive Learning (Videos/Reading)"
    elif state.energy_level == "High": style = "Active Recall & Problem Solving"

    prompt = f"""
    Create a detailed study schedule for {state.date}, starting at {state.current_time}.
    User Energy: {state.energy_level} ({style}).
    Time Available: {state.hours_available} Hours.
    Topics: {json.dumps(state.subjects)}
    INSTRUCTIONS: Provide 3 "key_concepts" and 2 "suggested_resources" per task.
    Return STRICT JSON: {{ "schedule": [ {{ "time": "HH:MM - HH:MM", "task": "Topic", "type": "Deep Work/Break", "reason": "Strategy", "key_concepts": [], "suggested_resources": [] }} ], "tip": "Motivation" }}
    """
    try:
        response = client.models.generate_content(model=get_best_model(), contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json"))
        return json.loads(response.text)
    except Exception as e: return {"error": str(e)}

# --- 4. HISTORY ---

@app.post("/log-session")
def log_session(log: LogRequest, db: Session = Depends(get_db)):
    db_log = StudyLog(topic=log.topic, duration_minutes=log.duration, xp_earned=log.xp)
    db.add(db_log)
    stats = db.query(UserStats).first()
    stats.total_xp += log.xp
    if stats.total_xp < 0: stats.total_xp = 0
    db.commit()
    return {"status": "Logged", "total_xp": stats.total_xp}

@app.get("/user-stats")
def get_stats(db: Session = Depends(get_db)):
    stats = db.query(UserStats).first()
    logs = db.query(StudyLog).order_by(StudyLog.timestamp.desc()).limit(50).all()
    return {"total_xp": stats.total_xp, "history": logs}

@app.delete("/reset-history")
def reset_history(reset_xp: bool = False, db: Session = Depends(get_db)):
    db.query(StudyLog).delete()
    if reset_xp:
        stats = db.query(UserStats).first()
        stats.total_xp = 0
    db.commit()
    return {"status": "History Cleared"}

# --- 5. CALENDAR CRUD (UPDATED WITH RICH DATA) ---

@app.post("/calendar/add")
def add_calendar_task(task: TaskCreate, db: Session = Depends(get_db)):
    # Serialize lists to JSON strings for storage
    concepts_str = json.dumps(task.key_concepts)
    resources_str = json.dumps(task.suggested_resources)
    
    db_task = PlannedTask(
        date=task.date, 
        time=task.time, 
        task=task.task, 
        type=task.type,
        reason=task.reason,
        key_concepts=concepts_str,
        suggested_resources=resources_str
    )
    db.add(db_task)
    db.commit()
    return {"status": "Added"}

@app.get("/calendar/get")
def get_calendar_tasks(date: str, db: Session = Depends(get_db)):
    tasks = db.query(PlannedTask).filter(PlannedTask.date == date).all()
    # Deserialize strings back to lists for Frontend
    result = []
    for t in tasks:
        result.append({
            "id": t.id,
            "date": t.date,
            "time": t.time,
            "task": t.task,
            "type": t.type,
            "reason": t.reason,
            "key_concepts": json.loads(t.key_concepts) if t.key_concepts else [],
            "suggested_resources": json.loads(t.suggested_resources) if t.suggested_resources else [],
            "completed": t.completed
        })
    return {"tasks": result}

@app.delete("/calendar/delete/{task_id}")
def delete_calendar_task(task_id: int, db: Session = Depends(get_db)):
    db.query(PlannedTask).filter(PlannedTask.id == task_id).delete()
    db.commit()
    return {"status": "Deleted"}

@app.delete("/calendar/reset")
def reset_calendar(date: Optional[str] = None, db: Session = Depends(get_db)):
    if date: db.query(PlannedTask).filter(PlannedTask.date == date).delete()
    else: db.query(PlannedTask).delete()
    db.commit()
    return {"status": "Calendar Cleared"}

@app.put("/calendar/update/{task_id}")
def update_calendar_task(task_id: int, update: TaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(PlannedTask).filter(PlannedTask.id == task_id).first()
    if not db_task: raise HTTPException(status_code=404, detail="Task not found")
    db_task.task = update.task
    db_task.time = update.time
    db.commit()
    return {"status": "Updated"}

# --- 6. QUIZ ---
@app.post("/generate-quiz")
def generate_quiz(req: QuizRequest):
    prompt = f"Create 3 hard MCQs for '{req.topic}'. Return JSON: {{ 'questions': [ {{ 'question': '?', 'options': ['A','B'], 'answer': 'A' }} ] }}"
    try:
        response = client.models.generate_content(
            model=get_best_model(), contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        return json.loads(response.text)
    except:
        return {"error": "Quiz failed"}