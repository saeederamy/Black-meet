from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import os

app = FastAPI()

# سرو کردن فایل‌های استاتیک (فرانت‌اند)
app.mount("/static", StaticFiles(directory="static"), name="static")

# کلاس مدیریت اتصالات وب‌سوکت
class ConnectionManager:
    def __init__(self):
        # ساختار: { websocket_object: {"client_id": str, "role": str} }
        self.active_connections = {}

    async def connect(self, websocket: WebSocket, client_id: str, role: str):
        await websocket.accept()
        self.active_connections[websocket] = {"client_id": client_id, "role": role}

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            del self.active_connections[websocket]

    async def broadcast(self, message: str, exclude: WebSocket = None):
        for connection in self.active_connections.keys():
            if connection != exclude:
                try:
                    await connection.send_text(message)
                except:
                    pass

    def get_client(self, client_id: str):
        for ws, data in self.active_connections.items():
            if data["client_id"] == client_id:
                return ws
        return None

manager = ConnectionManager()

@app.get("/")
async def get_index():
    return FileResponse('static/index.html')

# API لاگین با استفاده از فایل users.txt
@app.post("/api/login")
async def login_api(request: Request):
    data = await request.json()
    username = data.get("username")
    password = data.get("password")
    
    users_file = "users.txt"
    if not os.path.exists(users_file):
        return {"success": False, "message": "دیتابیس کاربران یافت نشد. لطفاً از طریق اسکریپت کاربر بسازید."}

    try:
        with open(users_file, "r") as f:
            for line in f:
                parts = line.strip().split(':')
                if len(parts) == 3:
                    u, p, r = parts
                    if u == username and p == password:
                        return {"success": True, "role": r}
    except Exception as e:
        return {"success": False, "message": f"خطا در خواندن اطلاعات: {str(e)}"}
        
    return {"success": False, "message": "نام کاربری یا رمز عبور اشتباه است."}

# مدیریت سیگنالینگ WebRTC و پیام‌های چت/ادمین
@app.websocket("/ws/{client_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, role: str):
    await manager.connect(websocket, client_id, role)
    
    # به بقیه اطلاع بده که کاربر جدیدی وارد شده است
    await manager.broadcast(json.dumps({"type": "user-joined", "client_id": client_id, "role": role}), exclude=websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # رله کردن سیگنال‌های WebRTC (Offer, Answer, ICE) به کاربر هدف
            if message['type'] in ['offer', 'answer', 'ice-candidate']:
                target_ws = manager.get_client(message['target'])
                if target_ws:
                    await target_ws.send_text(data)
            
            # پیام‌های چت متنی
            elif message['type'] == 'chat':
                await manager.broadcast(json.dumps({
                    "type": "chat",
                    "sender": client_id,
                    "text": message['text'],
                    "role": role
                }))
            
            # دستورات ادمین
            elif message['type'] == 'admin-action':
                if role == 'admin':
                    action = message['action']
                    if action == 'end-call':
                        await manager.broadcast(json.dumps({"type": "call-ended"}))
                    elif action in ['mute-mic', 'mute-cam']:
                        target_ws = manager.get_client(message['target_id'])
                        if target_ws:
                            await target_ws.send_text(json.dumps({"type": "force-action", "action": action}))

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(json.dumps({"type": "user-left", "client_id": client_id}))
