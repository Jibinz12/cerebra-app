import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css'; 
import { 
  Upload, Clock, Zap, Calendar as CalIcon,
  Trophy, History, Timer, Minus, Plus, CheckCircle, RefreshCw, Trash2,
  LayoutDashboard, List, Activity, Sparkles, Pencil, X, 
  ExternalLink, PieChart as PieIcon, Save, Eraser, ArrowRightCircle, Brain, ChevronRight, Menu, LogOut, User
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  BarChart, Bar, CartesianGrid 
} from 'recharts';

// --- STYLES ---
const calendarStyle = `
  .react-calendar { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: #e2e8f0; width: 100%; font-family: inherit; padding: 10px; }
  .react-calendar__tile { color: #cbd5e1; padding: 15px 5px; border-radius: 8px; }
  .react-calendar__tile:enabled:hover { background: rgba(139, 92, 246, 0.2); color: white; }
  .react-calendar__tile--active { background: #7c3aed !important; color: white !important; }
  .react-calendar__tile--now { background: rgba(255,255,255,0.1); color: #fbbf24; }
  .react-calendar__navigation button { color: white; min-width: 44px; background: none; font-size: 1.2em; font-weight: bold; }
  .react-calendar__navigation button:enabled:hover { background-color: rgba(255,255,255,0.1); border-radius: 8px; }
`;

// --- API HELPER ---
// Automatically adds the token to requests
const api = axios.create({
    baseURL: 'https://cerebra-backend.onrender.com' 
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('cerebra_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

const App = () => {
  // --- AUTH STATE ---
  const [token, setToken] = useState(localStorage.getItem('cerebra_token'));
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // --- APP STATE ---
  const [activeTab, setActiveTab] = useState('planner'); 
  const [currentTime, setCurrentTime] = useState(new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // Mobile Menu Toggle
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  
  const [energy, setEnergy] = useState('Medium');
  const [hours, setHours] = useState(2);
  const [topics, setTopics] = useState("");
  const [schedule, setSchedule] = useState(null);
  
  const [startTimeMode, setStartTimeMode] = useState('now'); 
  const [customStartTime, setCustomStartTime] = useState("09:00");
  
  const [completedTasks, setCompletedTasks] = useState({}); 
  const [activeTaskIndex, setActiveTaskIndex] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null); 
  const [editForm, setEditForm] = useState({ time: "", task: "", reason: "" });

  const [loading, setLoading] = useState(false);
  const [analyzingFile, setAnalyzingFile] = useState(false);
  const [focusTask, setFocusTask] = useState(null); 
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerDuration, setTimerDuration] = useState(25);

  // Quiz State
  const [quizData, setQuizData] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizLoading, setQuizLoading] = useState(false);
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  // --- AUTH FUNCTIONS ---
  const handleAuth = async (e) => {
      e.preventDefault();
      setAuthLoading(true);
      try {
          const formData = new URLSearchParams();
          formData.append('username', username);
          formData.append('password', password);

          if (authMode === 'signup') {
              await axios.post('http://localhost:8000/register', { username, password });
              alert("Account created! Logging in...");
              // Auto login after register
              const res = await axios.post('http://localhost:8000/token', formData);
              localStorage.setItem('cerebra_token', res.data.access_token);
              setToken(res.data.access_token);
          } else {
              const res = await axios.post('http://localhost:8000/token', formData);
              localStorage.setItem('cerebra_token', res.data.access_token);
              setToken(res.data.access_token);
          }
      } catch (err) {
          alert(err.response?.data?.detail || "Authentication failed");
      }
      setAuthLoading(false);
  };

  const logout = () => {
      localStorage.removeItem('cerebra_token');
      setToken(null);
      setSchedule(null); // Clear sensitive data
      setHistory([]);
  };

  // --- APP LOGIC ---
  const formatDate = (date) => {
    try {
      if (!date || isNaN(new Date(date).getTime())) return new Date().toISOString().split('T')[0];
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) { return "2025-01-01"; }
  };

  useEffect(() => {
    if (token) {
        fetchStats();
        if (selectedDate instanceof Date && !isNaN(selectedDate)) {
            fetchCalendarTasks(selectedDate);
        }
    }
    const clockInterval = setInterval(() => {
        const now = new Date();
        setCurrentTime(now);
        checkLiveStatus(now);
    }, 60000); 
    return () => clearInterval(clockInterval);
  }, [schedule, token]);

  // Reuse existing helpers (getDurationFromTime, checkLiveStatus, etc.)
  // Note: All axios calls below replaced with 'api' instance
  const getDurationFromTime = (timeStr) => {
      try {
          const [start, end] = timeStr.split(' - ');
          const [sH, sM] = start.split(':').map(Number);
          const [eH, eM] = end.split(':').map(Number);
          const startDate = new Date(0, 0, 0, sH, sM, 0);
          const endDate = new Date(0, 0, 0, eH, eM, 0);
          let diff = (endDate.getTime() - startDate.getTime()) / 1000 / 60; 
          if (diff < 0) diff += 24 * 60; 
          return diff > 0 ? diff : 25; 
      } catch (e) { return 25; }
  };

  const checkLiveStatus = (now) => {
    if (!schedule) return;
    if (formatDate(selectedDate) !== formatDate(new Date())) { setActiveTaskIndex(null); return; }
    const currentVal = now.getHours() * 60 + now.getMinutes();
    schedule.schedule.forEach((item, idx) => {
        try {
            const [startStr, endStr] = item.time.split(' - ');
            const [sH, sM] = startStr.split(':').map(Number);
            const [eH, eM] = endStr.split(':').map(Number);
            if (currentVal >= (sH*60+sM) && currentVal < (eH*60+eM)) setActiveTaskIndex(idx);
        } catch (e) {}
    });
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/user-stats');
      setHistory(res.data.history || []);
      setXp(res.data.total_xp || 0);
      setLevel(Math.floor((res.data.total_xp || 0) / 500) + 1);
    } catch (e) { if(e.response?.status === 401) logout(); }
  };

  const fetchCalendarTasks = async (date) => {
      if (!date) return;
      const dateStr = formatDate(date);
      try {
          const res = await api.get(`/calendar/get?date=${dateStr}`);
          setCalendarTasks(Array.isArray(res.data.tasks) ? res.data.tasks : []);
      } catch (e) { setCalendarTasks([]); }
  };

  const startEditing = (index, item) => {
      setEditingIndex(index);
      setEditForm({ time: item.time, task: item.task, reason: item.reason || "" });
  };

  const saveEdit = async (index, taskId) => {
      const newSchedule = { ...schedule };
      newSchedule.schedule[index] = { ...newSchedule.schedule[index], ...editForm };
      setSchedule(newSchedule);
      setEditingIndex(null);
      if (taskId) {
          try {
              await api.put(`/calendar/update/${taskId}`, { task: editForm.task, time: editForm.time });
              fetchCalendarTasks(selectedDate);
          } catch(e) {}
      }
  };

  const startFocusSession = (item) => {
    setFocusTask(item.task);
    const duration = getDurationFromTime(item.time);
    setTimerDuration(duration);
    setTimerSeconds(duration * 60);
  };

  useEffect(() => {
    let interval;
    if (focusTask && timerSeconds > 0) interval = setInterval(() => setTimerSeconds((t) => t - 1), 1000);
    else if (focusTask && timerSeconds === 0) completeSession();
    return () => clearInterval(interval);
  }, [focusTask, timerSeconds]);

  const completeSession = async () => {
    new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play();
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    await api.post('/log-session', { topic: focusTask, duration: timerDuration, xp: 100 });
    setFocusTask(null);
    fetchStats();
  };

  const startQuiz = async (topic) => {
      setQuizLoading(true); setQuizData(null); setQuizScore(0); setCurrentQuestion(0); setShowQuizResult(false); setSelectedAnswer(null);
      try {
          const res = await api.post('/generate-quiz', { topic: topic });
          if(res.data.questions) setQuizData(res.data.questions);
      } catch (e) { alert("Quiz Error"); }
      setQuizLoading(false);
  };

  const handleQuizAnswer = (selectedOption) => {
      if (selectedAnswer) return;
      setSelectedAnswer(selectedOption);
      const correct = quizData[currentQuestion].answer;
      if (selectedOption === correct) {
          setQuizScore(s => s + 1);
          confetti({ particleCount: 30, spread: 30, origin: { y: 0.8 } });
      }
  };

  const handleNextQuestion = () => {
      setSelectedAnswer(null);
      if (currentQuestion + 1 < quizData.length) setCurrentQuestion(c => c + 1);
      else {
          setShowQuizResult(true);
          const xpGained = quizScore * 20;
          if (xpGained > 0) { api.post('/log-session', { topic: "Quiz Completed", duration: 5, xp: xpGained }); fetchStats(); }
      }
  };

  const generateSchedule = async () => {
    if (!topics) return alert("Please add topics!");
    setLoading(true);
    let timeString = startTimeMode === 'now' ? `${currentTime.getHours()}:${currentTime.getMinutes()}` : customStartTime;
    const dateStr = formatDate(selectedDate);
    try {
      const res = await api.post('/generate-plan', {
        energy_level: energy, hours_available: hours, subjects: topics.split('\n').filter(t => t.trim() !== ""),
        current_time: timeString, date: dateStr 
      });
      setSchedule(res.data);
      setCompletedTasks({});
      const savePromises = res.data.schedule.map(item => {
          return api.post('/calendar/add', { 
              date: dateStr, time: item.time, task: item.task, type: item.type,
              reason: item.reason, key_concepts: item.key_concepts || [], suggested_resources: item.suggested_resources || []
          });
      });
      await Promise.all(savePromises);
      await fetchCalendarTasks(selectedDate);
      setActiveTab('planner');
      checkLiveStatus(new Date());
    } catch (err) { alert("AI Error"); }
    setLoading(false);
  };

  const loadDateToPlanner = () => {
      if (!calendarTasks || calendarTasks.length === 0) return alert("No tasks to load.");
      const reconstructedSchedule = {
          tip: `Viewing Archive: Plan for ${formatDate(selectedDate)}`,
          schedule: calendarTasks.map(t => ({
              time: t.time || "Flexible", task: t.task, type: t.type, reason: t.reason || "Archive",
              key_concepts: t.key_concepts || [], suggested_resources: t.suggested_resources || []
          }))
      };
      setSchedule(reconstructedSchedule);
      setActiveTab('planner');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAnalyzingFile(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api.post('/analyze-syllabus', formData);
      if (res.data.topics) setTopics(res.data.topics.join("\n\n"));
    } catch (err) { alert("File Error"); }
    setAnalyzingFile(false);
  };

  const toggleTaskCompletion = async (taskName, index) => {
      const wasCompleted = completedTasks[index];
      setCompletedTasks(prev => ({ ...prev, [index]: !wasCompleted }));
      const xpChange = wasCompleted ? -50 : 50; 
      await api.post('/log-session', { topic: wasCompleted ? `Undo: ${taskName}` : taskName, duration: 0, xp: xpChange });
      if (!wasCompleted) { confetti({ particleCount: 50, spread: 50, origin: { y: 0.7 } }); new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play(); }
      fetchStats(); 
  };
  
  const resetHistory = async () => { if(!window.confirm("Clear history?")) return; try { await api.delete(`/reset-history?reset_xp=${window.confirm("Reset XP?")}`); fetchStats(); } catch (e) {} };
  const deleteCalendarTask = async (taskId) => { if(!window.confirm("Delete?")) return; try { await api.delete(`/calendar/delete/${taskId}`); fetchCalendarTasks(selectedDate); } catch (e) {} };
  const editCalendarTask = async (taskId, currentText, currentTime) => { const newText = window.prompt("Name:", currentText); const newTime = window.prompt("Time:", currentTime); if (!newText) return; try { await api.put(`/calendar/update/${taskId}`, { task: newText, time: newTime }); fetchCalendarTasks(selectedDate); } catch (e) {} };
  const resetCalendar = async (onlyToday = false) => { if(!window.confirm("Clear?")) return; try { await api.delete(onlyToday ? `/calendar/reset?date=${formatDate(selectedDate)}` : `/calendar/reset`); fetchCalendarTasks(selectedDate); } catch (e) {} };

  // --- AUTH SCREEN ---
  if (!token) {
      return (
          <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-6 text-white font-sans">
              <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
                  <div className="flex justify-center mb-6">
                      <div className="p-4 bg-gradient-to-tr from-purple-600 to-blue-500 rounded-2xl shadow-lg shadow-purple-500/20">
                          <Sparkles size={32} className="text-white" />
                      </div>
                  </div>
                  <h1 className="text-3xl font-bold text-center mb-2">Welcome to Cerebra</h1>
                  <p className="text-center text-gray-400 mb-8 text-sm">Your AI-Powered Study Architect</p>
                  
                  <form onSubmit={handleAuth} className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Username</label>
                          <input type="text" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 focus:border-purple-500 outline-none transition-all" required/>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
                          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 focus:border-purple-500 outline-none transition-all" required/>
                      </div>
                      <button type="submit" disabled={authLoading} className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl font-bold mt-4 hover:opacity-90 transition-all flex justify-center">
                          {authLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : (authMode === 'login' ? 'Login' : 'Create Account')}
                      </button>
                  </form>
                  <div className="mt-6 text-center">
                      <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} className="text-sm text-gray-400 hover:text-white underline">
                          {authMode === 'login' ? "New here? Create an account" : "Already have an account? Login"}
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  // --- MAIN APP UI ---
  return (
    <div className="min-h-screen bg-[#0b0f19] text-white font-sans flex flex-col lg:flex-row overflow-hidden selection:bg-purple-500/30">
      <style>{calendarStyle}</style>
      
      {/* MOBILE HEADER */}
      <div className="lg:hidden p-4 flex justify-between items-center border-b border-white/5 bg-[#0b0f19] z-50">
          <div className="flex items-center gap-2">
              <div className="p-2 bg-gradient-to-tr from-purple-600 to-blue-500 rounded-lg"><Sparkles size={18}/></div>
              <span className="font-bold text-lg">Cerebra</span>
          </div>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 text-gray-400 hover:text-white"><Menu/></button>
      </div>

      {/* SIDEBAR (Responsive) */}
      <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} lg:flex flex-col w-full lg:w-64 bg-black/40 lg:bg-black/20 border-b lg:border-b-0 lg:border-r border-white/5 items-center lg:items-start py-8 lg:px-6 gap-8 z-40 backdrop-blur-xl fixed lg:relative h-full top-[69px] lg:top-0`}>
         <div className="hidden lg:flex items-center gap-3 mb-4">
             <div className="p-2 bg-gradient-to-tr from-purple-600 to-blue-500 rounded-xl shadow-lg shadow-purple-500/20"><Sparkles size={24} className="text-white" /></div>
             <div><span className="block text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Cerebra</span><p className="text-[10px] text-gray-500 font-medium tracking-widest uppercase -mt-1">Strategized.</p></div>
         </div>
         <nav className="flex flex-col w-full gap-2 px-6 lg:px-0">
             {[{ id: 'planner', icon: LayoutDashboard, label: 'Planner' }, { id: 'stats', icon: PieIcon, label: 'Analytics' }, { id: 'calendar', icon: CalIcon, label: 'Calendar' }, { id: 'history', icon: History, label: 'History' }].map(item => (
                 <button key={item.id} onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }} className={`flex items-center gap-4 p-3 rounded-xl transition-all w-full group ${activeTab === item.id ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
                     <item.icon size={20} className={activeTab === item.id ? 'text-purple-400' : 'text-gray-500 group-hover:text-white'} />
                     <span className="font-medium">{item.label}</span>
                 </button>
             ))}
         </nav>
         <div className="mt-auto w-full px-6 lg:px-0 flex flex-col gap-4">
             <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                 <div className="flex justify-between items-center mb-2"><span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Level {level}</span><Trophy size={14} className="text-yellow-500"/></div>
                 <div className="text-xs text-gray-500 mb-2">{xp} / {level * 500} XP</div>
                 <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.min((xp % 500) / 5, 100)}%` }} className="h-full bg-gradient-to-r from-purple-500 to-blue-500"/></div>
             </div>
             <button onClick={logout} className="flex items-center gap-2 p-3 text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-bold transition-all"><LogOut size={16}/> Logout</button>
         </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 flex flex-col relative overflow-y-auto h-[calc(100vh-70px)] lg:h-screen">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

        <header className="p-6 lg:p-8 pb-0 flex justify-between items-center">
             <div>
                <h2 className="text-2xl font-bold">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h2>
                <p className="text-gray-400 text-sm">{currentTime.toLocaleDateString()} • {currentTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
             </div>
        </header>

        <div className="p-6 lg:p-8 grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* LEFT CONFIG PANEL */}
            <div className="xl:col-span-1 space-y-6">
                <div className="bg-white/5 border border-white/5 p-6 rounded-3xl hover:border-white/10 transition-colors">
                    <div className="flex justify-between items-center mb-4"><h3 className="font-semibold text-gray-200">Syllabus</h3><Upload size={16} className="text-purple-400"/></div>
                    <label className="flex flex-col items-center justify-center w-full h-24 border border-dashed border-gray-700 rounded-2xl cursor-pointer hover:bg-white/5 transition-colors group">
                        {analyzingFile ? <span className="text-xs text-purple-400 animate-pulse">Analyzing...</span> : <span className="text-xs text-gray-500 group-hover:text-purple-300">Drop PDF, Img, Txt</span>}
                        <input type="file" onChange={handleFileUpload} className="hidden" accept=".pdf, .png, .jpg, .jpeg, .txt"/>
                    </label>
                </div>

                <div className="bg-white/5 border border-white/5 p-6 rounded-3xl space-y-6">
                    <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Topics</label><textarea value={topics} onChange={e => setTopics(e.target.value)} placeholder="e.g. Machine Learning, Cloud Computing" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 h-24 text-sm focus:outline-none focus:border-purple-500 transition-colors placeholder:text-gray-700"/></div>
                    <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Target Date</label><input type="date" value={formatDate(selectedDate)} onChange={(e) => { const val = e.target.value; if(val) { const d = new Date(val); const offsetDate = new Date(d.valueOf() + d.getTimezoneOffset() * 60000); setSelectedDate(offsetDate); fetchCalendarTasks(offsetDate); } }} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-purple-500"/></div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Start Time</label>
                        <div className="flex gap-2 mb-2">
                             <button onClick={() => setStartTimeMode('now')} className={`flex-1 py-2 text-xs rounded-lg border ${startTimeMode === 'now' ? 'bg-purple-600 border-purple-500 text-white' : 'border-white/10 text-gray-400'}`}>Start Now</button>
                             <button onClick={() => setStartTimeMode('custom')} className={`flex-1 py-2 text-xs rounded-lg border ${startTimeMode === 'custom' ? 'bg-purple-600 border-purple-500 text-white' : 'border-white/10 text-gray-400'}`}>Custom</button>
                        </div>
                        {startTimeMode === 'custom' && (<input type="time" value={customStartTime} onChange={e => setCustomStartTime(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-purple-500"/>)}
                    </div>
                    <div><div className="flex justify-between items-center mb-2"><label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Duration</label><span className="text-xs font-mono text-purple-300 bg-purple-900/20 px-2 py-1 rounded">{hours} HRS</span></div><input type="range" min="1" max="15" value={hours} onChange={e => setHours(e.target.value)} className="w-full h-1.5 bg-gray-800 rounded-full appearance-none cursor-pointer accent-purple-500"/></div>
                    <div><label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Current Energy</label><div className="grid grid-cols-3 gap-2">{['Low', 'Medium', 'High'].map(l => (<button key={l} onClick={() => setEnergy(l)} className={`py-3 rounded-xl text-xs font-semibold border transition-all ${energy === l ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/20' : 'bg-transparent border-white/10 text-gray-400 hover:bg-white/5'}`}>{l}</button>))}</div></div>
                    <button onClick={generateSchedule} disabled={loading} className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl font-bold hover:shadow-xl hover:shadow-purple-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <span className="animate-spin">⏳</span> : <Sparkles size={18}/>}{loading ? "Planning..." : "Generate Schedule"}</button>
                </div>
            </div>

            {/* RIGHT PANEL (TABS) */}
            <div className="xl:col-span-2 pb-20">
                {activeTab === 'planner' && (
                    <div className="space-y-6">
                        {!schedule && <div className="h-full min-h-[400px] flex flex-col items-center justify-center border border-dashed border-gray-800 rounded-3xl bg-white/[0.02]"><LayoutDashboard size={48} className="text-gray-800 mb-4"/><p className="text-gray-600">Configure your session on the left to start.</p></div>}
                        {schedule && (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                                <div className="bg-gradient-to-r from-emerald-900/30 to-green-900/20 border border-green-500/20 p-5 rounded-2xl flex gap-4 items-start"><div className="p-2 bg-green-500/10 rounded-full text-green-400"><Activity size={18}/></div><div><h4 className="text-green-400 font-bold text-sm mb-1">Strategy Tip</h4><p className="text-green-100/70 text-sm leading-relaxed">{schedule.tip}</p></div></div>
                                <div className="grid gap-4">
                                    {schedule.schedule.map((item, idx) => {
                                        const isLive = activeTaskIndex === idx;
                                        const isDone = completedTasks[idx];
                                        const isBreak = item.type.toLowerCase().includes('break');
                                        const isEditing = editingIndex === idx;
                                        return (
                                            <div key={idx} className={`p-6 rounded-3xl border transition-all relative overflow-hidden group ${isDone ? 'bg-black/40 border-green-500/20 opacity-60' : isLive ? 'bg-blue-900/10 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.1)]' : isBreak ? 'bg-emerald-900/5 border-emerald-500/20' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                                                {isLive && !isDone && <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded-full animate-pulse shadow-lg shadow-blue-500/40"><div className="w-1.5 h-1.5 bg-white rounded-full"/> LIVE</div>}
                                                {isEditing ? (
                                                    <div className="space-y-3 mb-4">
                                                        <div className="flex gap-2"><input type="text" value={editForm.time} onChange={e => setEditForm({...editForm, time: e.target.value})} className="bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-sm font-mono w-32 focus:border-purple-500 outline-none"/><input type="text" value={editForm.task} onChange={e => setEditForm({...editForm, task: e.target.value})} className="bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-sm font-bold flex-1 focus:border-purple-500 outline-none"/></div>
                                                        <input type="text" value={editForm.reason} onChange={e => setEditForm({...editForm, reason: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-xs text-gray-400 focus:border-purple-500 outline-none"/>
                                                        <div className="flex gap-2"><button onClick={() => saveEdit(idx, null)} className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded flex items-center gap-1"><Save size={12}/> Save</button><button onClick={() => setEditingIndex(null)} className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded flex items-center gap-1"><X size={12}/> Cancel</button></div>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div><div className={`text-xs font-mono font-bold mb-2 flex items-center gap-2 ${isLive ? 'text-blue-400' : isBreak ? 'text-emerald-500' : 'text-purple-400'}`}><Clock size={12}/> {item.time} {item.type.toUpperCase()}</div><h3 className={`text-xl font-bold ${isDone ? 'line-through text-gray-500' : 'text-white'}`}>{item.task}</h3><p className="text-xs text-gray-500 mt-1">{item.reason}</p></div>
                                                        {!isBreak && (<div className="flex gap-2">{!isDone && <button onClick={() => startEditing(idx, item)} className="p-2.5 bg-white/5 hover:bg-yellow-500 text-gray-400 hover:text-white rounded-xl transition-all"><Pencil size={18}/></button>}<button onClick={() => toggleTaskCompletion(item.task, idx)} className={`p-2.5 rounded-xl transition-all ${isDone ? 'bg-green-500 text-white' : 'bg-white/10 hover:bg-green-500 text-gray-400'}`}>{isDone ? <RefreshCw size={18}/> : <CheckCircle size={18}/>}</button>{!isDone && (<button onClick={() => startFocusSession(item)} className="p-2.5 bg-white/10 hover:bg-blue-500 text-gray-400 hover:text-white rounded-xl transition-all"><Timer size={18}/></button>)}{!isDone && <button onClick={() => startQuiz(item.task)} title="Take Quiz" className="p-2.5 bg-purple-500/10 hover:bg-purple-600 text-purple-400 hover:text-white rounded-xl transition-all"><Brain size={18}/></button>}</div>)}
                                                    </div>
                                                )}
                                                {!isBreak && !isDone && (<div className="space-y-4">{item.key_concepts && (<div className="bg-black/20 rounded-2xl p-4 border border-white/5"><p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><List size={12}/> Key Concepts</p><ul className="space-y-2">{item.key_concepts.map((concept, cIdx) => (<li key={cIdx} className="text-sm text-gray-300 flex items-start gap-2.5"><span className="w-1.5 h-1.5 bg-purple-500 rounded-full mt-1.5 shrink-0"/>{concept}</li>))}</ul></div>)}{item.suggested_resources && (<div className="flex flex-wrap gap-2">{item.suggested_resources.map((res, rIdx) => { const isVideo = res.toLowerCase().includes('youtube'); const url = isVideo ? `https://www.youtube.com/results?search_query=${encodeURIComponent(res.replace('YouTube:', '').trim())}` : `https://www.google.com/search?q=${encodeURIComponent(res.replace('Docs:', '').replace('Article:', '').trim())}`; return (<a key={rIdx} href={url} target="_blank" rel="noopener noreferrer" className={`text-[10px] px-3 py-2 rounded-lg border transition-all flex items-center gap-1.5 no-underline ${isVideo ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-blue-500/10 border-blue-500/20 text-blue-300'}`}><ExternalLink size={10}/> {res}</a>);})}</div>)}</div>)}
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </div>
                )}
                
                {activeTab === 'stats' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/5"><h4 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Total Focus Time</h4><div className="text-3xl font-bold text-white">{Math.floor(history.reduce((acc, curr) => acc + (curr.duration_minutes || 0), 0) / 60)}h {history.reduce((acc, curr) => acc + (curr.duration_minutes || 0), 0) % 60}m</div></div>
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/5"><h4 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Total XP Earned</h4><div className="text-3xl font-bold text-purple-400">{xp}</div></div>
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/5"><h4 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">Sessions Completed</h4><div className="text-3xl font-bold text-blue-400">{history.length}</div></div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 h-80"><h3 className="mb-6 font-bold flex items-center gap-2"><Activity size={16}/> XP Growth</h3><ResponsiveContainer width="100%" height="100%"><LineChart data={[...history].reverse()}><CartesianGrid strokeDasharray="3 3" stroke="#333" /><XAxis dataKey="timestamp" tick={false} /><YAxis stroke="#666" /><Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} /><Line type="monotone" dataKey="xp_earned" stroke="#8b5cf6" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div>
                            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 h-80"><h3 className="mb-6 font-bold flex items-center gap-2"><Clock size={16}/> Session Duration</h3><ResponsiveContainer width="100%" height="100%"><BarChart data={[...history].reverse().slice(-10)}><CartesianGrid strokeDasharray="3 3" stroke="#333" /><XAxis dataKey="topic" tick={false} /><YAxis stroke="#666" /><Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} /><Bar dataKey="duration_minutes" fill="#3b82f6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                        </div>
                    </div>
                )}

                {activeTab === 'calendar' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                        <div className="bg-white/5 p-8 rounded-3xl border border-white/5 shadow-2xl">
                            <Calendar 
                                onChange={(val) => { if(val instanceof Date) { setSelectedDate(val); fetchCalendarTasks(val); }}} 
                                value={selectedDate instanceof Date ? selectedDate : new Date()} 
                            />
                            <div className="flex flex-col lg:flex-row justify-between mt-4 pt-4 border-t border-white/5 gap-3">
                                <button onClick={loadDateToPlanner} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl transition-all font-bold flex items-center justify-center gap-2"><ArrowRightCircle size={16}/> Open in Planner</button>
                                <div className="flex gap-2">
                                    <button onClick={() => resetCalendar(true)} className="flex items-center gap-2 text-xs bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white px-3 py-2 rounded-xl transition-all"><Eraser size={14}/> Clear</button>
                                    <button onClick={() => resetCalendar(false)} className="flex items-center gap-2 text-xs bg-red-900/20 hover:bg-red-600 text-red-400 hover:text-white px-3 py-2 rounded-xl transition-all border border-red-500/20"><Trash2 size={14}/> Reset</button>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-purple-200"><CalIcon size={18}/> Plan for {formatDate(selectedDate)}</h3>
                            {(!calendarTasks || calendarTasks.length === 0) ? <p className="text-gray-500 text-sm italic py-4">No specific tasks recorded for this date.</p> : null}
                            <div className="space-y-2">{(calendarTasks || []).map(t => (<div key={t.id} className="flex justify-between items-center p-4 bg-black/20 rounded-2xl border border-white/5 group hover:border-white/10 transition-colors"><div className="flex items-center gap-3"><span className="text-xs font-mono text-purple-400 bg-purple-900/20 px-2 py-1 rounded">{t.time || "N/A"}</span><span className="font-medium text-sm">{t.task}</span><span className="text-[10px] font-bold text-purple-300 bg-purple-500/10 px-2 py-1 rounded-lg uppercase tracking-wide">{t.type}</span></div><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => editCalendarTask(t.id, t.task, t.time)} className="p-2 text-gray-400 hover:text-blue-400"><Pencil size={14}/></button><button onClick={() => deleteCalendarTask(t.id)} className="p-2 text-gray-400 hover:text-red-400"><Trash2 size={14}/></button></div></div>))}</div>
                        </div>
                    </div>
                )}
                {activeTab === 'history' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                       <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5"><h2 className="text-lg font-bold flex gap-2 items-center"><History size={18}/> Session Log</h2><button onClick={resetHistory} className="flex gap-2 text-xs bg-red-500/10 text-red-400 px-4 py-2 rounded-xl hover:bg-red-500 hover:text-white transition-all font-bold"><Trash2 size={14}/> Clear Log</button></div>
                       {history.map(log => (<div key={log.id} className={`bg-white/5 p-5 rounded-2xl border-l-4 flex justify-between items-center ${log.xp_earned > 0 ? 'border-green-500' : 'border-red-500'}`}><div><h3 className="font-medium text-sm text-white mb-1">{log.topic}</h3><p className="text-xs text-gray-500">{new Date(log.timestamp).toLocaleDateString()} • {log.duration_minutes > 0 ? `${log.duration_minutes}m Session` : 'Manual Update'}</p></div><span className={`text-sm font-bold ${log.xp_earned > 0 ? 'text-green-400' : 'text-red-400'}`}>{log.xp_earned > 0 ? '+' : ''}{log.xp_earned} XP</span></div>))}
                    </div>
                )}
            </div>
        </div>
      </div>
      
      {/* FOCUS MODE */}
      <AnimatePresence>
        {focusTask && (<motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-[#0b0f19] flex flex-col items-center justify-center"><div className="absolute top-8 right-8"><button onClick={() => setFocusTask(null)} className="text-gray-500 hover:text-white font-bold tracking-widest text-sm">EXIT SESSION</button></div><div className="mb-12 p-4 bg-purple-500/10 rounded-full animate-pulse"><Zap size={48} className="text-purple-500"/></div><h1 className="text-3xl md:text-5xl font-bold text-white mb-4 text-center px-4 max-w-4xl">{focusTask}</h1><p className="text-gray-400 mb-12">Focus Mode Active. Do not switch tabs.</p><div className="text-[120px] md:text-[180px] font-mono font-bold text-white/90 mb-12 tabular-nums leading-none tracking-tighter shadow-purple-500/50 drop-shadow-2xl">{Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')}</div><div className="flex gap-4"><button onClick={() => { if(timerDuration>5) { setTimerDuration(d=>d-5); setTimerSeconds((timerDuration-5)*60); }}} className="p-6 border border-white/10 rounded-full hover:bg-white/5 transition-all active:scale-95"><Minus size={24}/></button><button onClick={() => { setTimerDuration(d=>d+5); setTimerSeconds((timerDuration+5)*60); }} className="p-6 border border-white/10 rounded-full hover:bg-white/5 transition-all active:scale-95"><Plus size={24}/></button></div></motion.div>)}
      </AnimatePresence>

      {/* QUIZ OVERLAY */}
      <AnimatePresence>
        {(quizLoading || quizData) && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#1e293b] w-full max-w-lg rounded-3xl p-8 border border-white/10 shadow-2xl relative">
                    <button onClick={closeQuiz} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X/></button>
                    {quizLoading ? (
                        <div className="flex flex-col items-center py-12"><Sparkles className="animate-spin text-purple-500 mb-4" size={48}/><p className="text-purple-200 font-bold animate-pulse">Generating Quiz...</p></div>
                    ) : showQuizResult ? (
                        <div className="text-center py-8">
                            <Trophy size={64} className="text-yellow-400 mx-auto mb-6"/>
                            <h2 className="text-3xl font-bold text-white mb-2">Quiz Complete!</h2>
                            <p className="text-gray-400 mb-6">You scored {quizScore} out of {quizData.length}</p>
                            <div className="text-4xl font-bold text-purple-400 mb-8">+{Math.max(0, quizScore * 20)} XP</div>
                            <button onClick={closeQuiz} className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-bold transition-all">Close</button>
                        </div>
                    ) : (
                        <div>
                            <div className="flex justify-between items-center mb-6"><span className="text-xs font-bold text-purple-400 tracking-wider">QUESTION {currentQuestion + 1}/{quizData.length}</span><span className="text-xs font-bold text-gray-500">Score: {quizScore}</span></div>
                            <h3 className="text-xl font-bold text-white mb-8">{quizData[currentQuestion].question}</h3>
                            <div className="space-y-3">
                                {quizData[currentQuestion].options.map((opt, i) => {
                                    let bgClass = "bg-white/5 hover:bg-purple-600/20";
                                    if (selectedAnswer) {
                                        if (opt === quizData[currentQuestion].answer) bgClass = "bg-green-500/20 border-green-500 text-green-300 shadow-[0_0_15px_rgba(34,197,94,0.3)]";
                                        else if (opt === selectedAnswer) bgClass = "bg-red-500/20 border-red-500 text-red-300";
                                        else bgClass = "opacity-50";
                                    }
                                    return (
                                        <button key={i} onClick={() => handleQuizAnswer(opt)} className={`w-full text-left p-4 rounded-xl border border-white/5 transition-all text-sm font-medium ${bgClass}`} disabled={!!selectedAnswer}>{opt}</button>
                                    );
                                })}
                            </div>
                            {selectedAnswer && (
                                <div className="mt-6 flex justify-end">
                                    <button onClick={handleNextQuestion} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold transition-all">Next <ChevronRight size={16}/></button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
