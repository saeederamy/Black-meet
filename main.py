from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import uuid
import subprocess
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
ROOMS_FILE = os.path.join(BASE_DIR, "rooms.json")
USERS_FILE = os.path.join(BASE_DIR, "users.txt")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

def save_rooms(rooms):
    with open(ROOMS_FILE, "w", encoding="utf-8") as f:
        json.dump(rooms, f)

def load_rooms():
    if not os.path.exists(ROOMS_FILE):
        default = {"default_room": {"name": "General Lounge", "members": []}}
        save_rooms(default)
        return default
    try:
        with open(ROOMS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        default = {"default_room": {"name": "General Lounge", "members": []}}
        save_rooms(default)
        return default

# معماری جدید بر پایه صف‌های HTTP
class ConnectionManager:
    def __init__(self):
        self.rooms = {}
        self.meeting_status = {}
        self.chat_history = {}

    async def connect(self, room_id: str, client_id: str, role: str):
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
            self.meeting_status[room_id] = "active"
            self.chat_history[room_id] = []
        self.rooms[room_id][client_id] = {"role": role, "queue": asyncio.Queue()}

    def disconnect(self, room_id: str, client_id: str):
        if room_id in self.rooms and client_id in self.rooms[room_id]:
            del self.rooms[room_id][client_id]

    async def broadcast(self, room_id: str, message: dict, exclude: str = None):
        if room_id in self.rooms:
            for cid, data in self.rooms[room_id].items():
                if cid != exclude:
                    await data["queue"].put(message)

    async def send_personal(self, room_id: str, target_client_id: str, message: dict):
        if room_id in self.rooms and target_client_id in self.rooms[room_id]:
            await self.rooms[room_id][target_client_id]["queue"].put(message)

manager = ConnectionManager()

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(STATIC_DIR, 'index.html'))

@app.post("/api/login")
async def login_api(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        password = data.get("password")
        if not os.path.exists(USERS_FILE):
            return {"success": False, "message": "Database not found."}
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split(':')
                if len(parts) >= 3:
                    u, p, r = parts[:3]
                    if u == username and p == password:
                        return {"success": True, "role": r, "username": u}
        return {"success": False, "message": "Invalid Credentials."}
    except Exception as e:
        return {"success": False, "message": str(e)}

def restart_server():
    import time
    time.sleep(2)
    os.system("systemctl restart black-meet.service")

@app.post("/api/system/update")
async def system_update(request: Request, bg_tasks: BackgroundTasks):
    try:
        subprocess.run(["git", "fetch", "--all"], cwd=BASE_DIR, check=True)
        status = subprocess.run(["git", "status", "-uno"], cwd=BASE_DIR, capture_output=True, text=True)
        if "Your branch is up to date" in status.stdout:
            return {"success": True, "updated": False, "message": "System is up-to-date!"}
        subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=BASE_DIR, check=True)
        pip_path = os.path.join(BASE_DIR, "venv", "bin", "pip")
        if os.path.exists(pip_path):
            subprocess.run([pip_path, "install", "-r", "requirements.txt"], cwd=BASE_DIR)
        bg_tasks.add_task(restart_server)
        return {"success": True, "updated": True, "message": "Updating..."}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.post("/api/users/list")
async def get_users(request: Request):
    try:
        users = []
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split(':')
                    if len(parts) >= 3:
                        users.append(parts[0])
        return {"success": True, "users": users}
    except Exception as e:
        return {"success": False, "message": str(e), "users": []}

@app.post("/api/rooms/list")
async def get_rooms(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        role = data.get("role")
        rooms = load_rooms()
        user_rooms = {}
        for r_id, r_data in rooms.items():
            if role == 'admin' or username in r_data.get("members", []):
                user_rooms[r_id] = r_data
        return {"success": True, "rooms": user_rooms}
    except Exception as e:
        return {"success": False, "message": str(e), "rooms": {}}

@app.post("/api/room_action")
async def room_action(request: Request):
    try:
        data = await request.json()
        action = data.get("action")
        rooms = load_rooms()
        if action == "create":
            new_id = "room_" + uuid.uuid4().hex[:8]
            rooms[new_id] = {"name": data.get("name"), "members": []}
            save_rooms(rooms)
            return {"success": True}
        elif action == "rename":
            r_id = data.get("room_id")
            if r_id in rooms:
                rooms[r_id]["name"] = data.get("name")
                save_rooms(rooms)
                return {"success": True}
        elif action == "delete":
            r_id = data.get("room_id")
            if r_id in rooms:
                del rooms[r_id]
                save_rooms(rooms)
                return {"success": True}
        elif action == "update_members":
            r_id = data.get("room_id")
            if r_id in rooms:
                rooms[r_id]["members"] = data.get("members", [])
                save_rooms(rooms)
                return {"success": True}
        return {"success": False}
    except Exception as e:
        return {"success": False, "message": str(e)}

# --- سیستم انقلابی HTTP Long Polling جایگزین وب‌سوکت ---
@app.post("/api/signaling/join")
async def sig_join(request: Request):
    data = await request.json()
    room_id = data.get("room_id")
    client_id = data.get("client_id")
    role = data.get("role")
    
    await manager.connect(room_id, client_id, role)
    if manager.chat_history[room_id]:
        await manager.send_personal(room_id, client_id, {"type": "chat-history", "history": manager.chat_history[room_id]})
    if manager.meeting_status[room_id] == "paused" and role != 'admin':
        await manager.send_personal(room_id, client_id, {"type": "meeting-paused"})
    else:
        await manager.broadcast(room_id, {"type": "user-joined", "client_id": client_id, "role": role}, exclude=client_id)
    return {"success": True}

@app.get("/api/signaling/poll")
async def sig_poll(room_id: str, client_id: str, t: str = None):
    if room_id not in manager.rooms or client_id not in manager.rooms[room_id]:
        return []
    queue = manager.rooms[room_id][client_id]["queue"]
    messages = []
    try:
        # نگه داشتن اتصال برای ۲۰ ثانیه (دور زدن فایروال)
        msg = await asyncio.wait_for(queue.get(), timeout=20.0)
        messages.append(msg)
        while not queue.empty():
            messages.append(queue.get_nowait())
    except asyncio.TimeoutError:
        messages.append({"type": "ping"})
    return messages

@app.post("/api/signaling/send")
async def sig_send(request: Request):
    data = await request.json()
    room_id = data.get("room_id")
    client_id = data.get("client_id")
    message = data.get("message")
    
    if room_id not in manager.rooms or client_id not in manager.rooms[room_id]:
        return {"success": False}
        
    role = manager.rooms[room_id][client_id]["role"]
    mtype = message.get("type")
    
    if mtype in ['offer', 'answer', 'ice-candidate']:
        await manager.send_personal(room_id, message['target'], message)
    elif mtype in ['cam-state', 'stop-screen']:
        await manager.broadcast(room_id, message, exclude=client_id)
    elif mtype == 'chat':
        chat_payload = {"type": "chat", "sender": client_id, "text": message['text'], "senderName": message.get('senderName', 'User'), "role": role}
        manager.chat_history[room_id].append(chat_payload)
        if len(manager.chat_history[room_id]) > 200: manager.chat_history[room_id].pop(0)
        await manager.broadcast(room_id, chat_payload)
    elif mtype == 'admin-action' and role == 'admin':
        action = message.get('action')
        if action == 'pause-meeting':
            manager.meeting_status[room_id] = "paused"
            await manager.broadcast(room_id, {"type": "meeting-paused"})
        elif action == 'resume-meeting':
            manager.meeting_status[room_id] = "active"
            await manager.broadcast(room_id, {"type": "meeting-resumed"})
        elif action == 'clear-chat':
            manager.chat_history[room_id] = []
            await manager.broadcast(room_id, {"type": "chat-cleared"})
        elif action in ['mute-mic', 'mute-cam']:
            await manager.send_personal(room_id, message['target_id'], {"type": "force-action", "action": action})
    elif mtype == 'user-joined': # Triggered on unpause
         await manager.broadcast(room_id, {"type": "user-joined", "client_id": client_id, "role": role}, exclude=client_id)
            
    return {"success": True}

@app.post("/api/signaling/leave")
async def sig_leave(request: Request):
    data = await request.json()
    room_id = data.get("room_id")
    client_id = data.get("client_id")
    manager.disconnect(room_id, client_id)
    await manager.broadcast(room_id, {"type": "user-left", "client_id": client_id})
    return {"success": True}
