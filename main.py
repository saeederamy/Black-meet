from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json

app = FastAPI()

# سرو کردن فایل‌های استاتیک (HTML, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

class ConnectionManager:
    def __init__(self):
        # ساختار: { websocket: {"client_id": str, "role": str} }
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
                await connection.send_text(message)

    def get_client(self, client_id: str):
        for ws, data in self.active_connections.items():
            if data["client_id"] == client_id:
                return ws
        return None

manager = ConnectionManager()

@app.get("/")
async def get_index():
    return FileResponse('static/index.html')

@app.websocket("/ws/{client_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, role: str):
    await manager.connect(websocket, client_id, role)
    # اطلاع به سایرین که کاربر جدیدی متصل شد
    await manager.broadcast(json.dumps({"type": "user-joined", "client_id": client_id, "role": role}), exclude=websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # رله کردن سیگنال‌های WebRTC
            if message['type'] in ['offer', 'answer', 'ice-candidate']:
                target_ws = manager.get_client(message['target'])
                if target_ws:
                    await target_ws.send_text(data)
            
            # پیام‌های چت
            elif message['type'] == 'chat':
                await manager.broadcast(json.dumps({
                    "type": "chat",
                    "sender": client_id,
                    "text": message['text'],
                    "role": role
                }))
            
            # دستورات کنترلی ادمین
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
