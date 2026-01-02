import os
import json
import datetime
import io
from typing import List, Optional
from datetime import timedelta

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
import pypdf
from PIL import Image 

from google import genai
from google.genai import types
from passlib.context import CryptContext
from jose import JWTError, jwt

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# --- CONFIG ---
SECRET_KEY = "YOUR_SUPER_SECRET_KEY_HERE" # Change this for production!
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 300

# --- DATABASE ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./study.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- MODELS ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

class StudyLog(Base):
    __tablename__ = "study_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id")) # Linked to User
    topic = Column(String)
    duration_minutes = Column(Integer)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    xp_earned = Column(Integer)

class UserStats(Base):
    __tablename__ = "user_stats"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id")) # Linked to User
    total_xp = Column(Integer, default=0)

class PlannedTask(Base):
    __tablename__ = "planned_tasks"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id")) # Linked to User
    date = Column(String, index=True) 
    time = Column(String)
    task = Column(String)
    type = Column(String)
    reason = Column(String, nullable=True)
    key_concepts = Column(String, nullable=True)
    suggested_resources = Column(String, nullable=True)
    completed = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)

# --- SECURITY UTILS ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise credentials_exception
    except JWTError: raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None: raise credentials_exception
    return user

app = FastAPI(title="Cerebra Engine")

origins = [
    "http://localhost:5173",
    "https://cerebra-app.vercel.app", # Your actual Vercel URL from the screenshot
    "https://cerebra-app.vercel.app/" # Add with trailing slash just in case
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, # Use the list above
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- AUTH ENDPOINTS ---

class UserCreate(BaseModel):
    username: str
    password: str

@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user: raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    # Init Stats
    db.add(UserStats(user_id=new_user.id, total_xp=0))
    db.commit()
    return {"msg": "User created successfully"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# --- AI ENDPOINTS ---
class ScheduleRequest(BaseModel):
    energy_level: str
    hours_available: int
    subjects: List[str]
    current_time: str
    date: str 

def get_best_model(): return "gemini-flash-latest"

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
def generate_plan(state: ScheduleRequest, current_user: User = Depends(get_current_user)):
    style = "balanced"
    if state.energy_level == "Low": style = "Passive Learning"
    elif state.energy_level == "High": style = "Active Recall"
    prompt = f"""
    Create schedule for {state.date}, start {state.current_time}. Energy: {state.energy_level}. Time: {state.hours_available}h.
    Topics: {json.dumps(state.subjects)}
    Return JSON: {{ "schedule": [ {{ "time": "HH:MM - HH:MM", "task": "Topic", "type": "Deep Work/Break", "reason": "Strategy", "key_concepts": [], "suggested_resources": [] }} ], "tip": "Motivation" }}
    """
    try:
        response = client.models.generate_content(model=get_best_model(), contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json"))
        return json.loads(response.text)
    except Exception as e: return {"error": str(e)}

# --- USER DATA ENDPOINTS (PROTECTED) ---

class LogRequest(BaseModel):
    topic: str
    duration: int
    xp: int 

@app.post("/log-session")
def log_session(log: LogRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_log = StudyLog(user_id=current_user.id, topic=log.topic, duration_minutes=log.duration, xp_earned=log.xp)
    db.add(db_log)
    stats = db.query(UserStats).filter(UserStats.user_id == current_user.id).first()
    if not stats:
        stats = UserStats(user_id=current_user.id, total_xp=0)
        db.add(stats)
    stats.total_xp += log.xp
    db.commit()
    return {"status": "Logged", "total_xp": stats.total_xp}

@app.get("/user-stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    stats = db.query(UserStats).filter(UserStats.user_id == current_user.id).first()
    if not stats: stats = UserStats(user_id=current_user.id, total_xp=0)
    logs = db.query(StudyLog).filter(StudyLog.user_id == current_user.id).order_by(StudyLog.timestamp.desc()).limit(50).all()
    return {"total_xp": stats.total_xp, "history": logs}

@app.delete("/reset-history")
def reset_history(reset_xp: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(StudyLog).filter(StudyLog.user_id == current_user.id).delete()
    if reset_xp:
        stats = db.query(UserStats).filter(UserStats.user_id == current_user.id).first()
        if stats: stats.total_xp = 0
    db.commit()
    return {"status": "History Cleared"}

# --- CALENDAR ENDPOINTS (PROTECTED) ---
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

@app.post("/calendar/add")
def add_calendar_task(task: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    concepts_str = json.dumps(task.key_concepts)
    resources_str = json.dumps(task.suggested_resources)
    db_task = PlannedTask(
        user_id=current_user.id,
        date=task.date, time=task.time, task=task.task, type=task.type,
        reason=task.reason, key_concepts=concepts_str, suggested_resources=resources_str
    )
    db.add(db_task)
    db.commit()
    return {"status": "Added"}

@app.get("/calendar/get")
def get_calendar_tasks(date: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tasks = db.query(PlannedTask).filter(PlannedTask.user_id == current_user.id, PlannedTask.date == date).all()
    result = []
    for t in tasks:
        result.append({
            "id": t.id, "date": t.date, "time": t.time, "task": t.task, "type": t.type, "reason": t.reason,
            "key_concepts": json.loads(t.key_concepts) if t.key_concepts else [],
            "suggested_resources": json.loads(t.suggested_resources) if t.suggested_resources else [],
            "completed": t.completed
        })
    return {"tasks": result}

@app.delete("/calendar/delete/{task_id}")
def delete_calendar_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(PlannedTask).filter(PlannedTask.id == task_id, PlannedTask.user_id == current_user.id).delete()
    db.commit()
    return {"status": "Deleted"}

@app.delete("/calendar/reset")
def reset_calendar(date: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if date: db.query(PlannedTask).filter(PlannedTask.user_id == current_user.id, PlannedTask.date == date).delete()
    else: db.query(PlannedTask).filter(PlannedTask.user_id == current_user.id).delete()
    db.commit()
    return {"status": "Calendar Cleared"}

@app.put("/calendar/update/{task_id}")
def update_calendar_task(task_id: int, update: TaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_task = db.query(PlannedTask).filter(PlannedTask.id == task_id, PlannedTask.user_id == current_user.id).first()
    if not db_task: raise HTTPException(status_code=404, detail="Task not found")
    db_task.task = update.task
    db_task.time = update.time
    db.commit()
    return {"status": "Updated"}

@app.post("/generate-quiz")
def generate_quiz(req: QuizRequest): # No Auth needed for quiz generation logic itself
    prompt = f"Create 3 hard MCQs for '{req.topic}'. Return JSON: {{ 'questions': [ {{ 'question': '?', 'options': ['A','B'], 'answer': 'A' }} ] }}"
    try:
        response = client.models.generate_content(
            model=get_best_model(), contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        return json.loads(response.text)
    except: return {"error": "Quiz failed"}

