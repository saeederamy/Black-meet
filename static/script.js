let ws;
let localStream;
let peerConnections = {};
const configuration = { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] };
const clientId = Math.random().toString(36).substring(7);
let myRole = 'user';
let isScreenSharing = false;

// --- سیستم لاگین ---
async function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    
    if (!user || !pass) {
        alert("لطفاً نام کاربری و رمز عبور را وارد کنید.");
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        
        const result = await response.json();
        
        if (result.success) {
            myRole = result.role;
            document.getElementById('role-display').innerText = myRole === 'admin' ? 'مدیر' : 'کاربر عادی';
            
            if (myRole === 'admin') {
                document.getElementById('admin-controls').style.display = 'inline';
            }

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('meet-screen').style.display = 'block';

            // گرفتن دسترسی وب‌کم و میکروفون
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = localStream;

            connectWebSocket();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error("Login Error:", error);
        alert("خطا در ارتباط با سرور.");
    }
}

// --- اتصال وب‌سوکت ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${clientId}/${myRole}`);

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        switch (message.type) {
            case 'user-joined':
                // وقتی شخص جدیدی آمد، ما به عنوان آغازگر (Initiator) به او Offer می‌دهیم
                createPeerConnection(message.client_id, true);
                break;
            case 'offer':
                handleOffer(message);
                break;
            case 'answer':
                handleAnswer(message);
                break;
            case 'ice-candidate':
                handleIceCandidate(message);
                break;
            case 'user-left':
                removeUserVideo(message.client_id);
                break;
            case 'chat':
                appendChat(message);
                break;
            case 'call-ended':
                alert('مدیر به جلسه پایان داد.');
                window.location.reload();
                break;
            case 'force-action':
                if (message.action === 'mute-mic') toggleAudio(true);
                if (message.action === 'mute-cam') toggleVideo(true);
                break;
        }
    };
}

// --- مدیریت ارتباطات WebRTC P2P ---
function createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[peerId] = pc;

    // اضافه کردن مدیاهای خودمان به ارتباط
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // ارسال کاندیداهای ICE برای دور زدن فایروال
    pc.onicecandidate = event => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ice-candidate', target: peerId, candidate: event.candidate }));
        }
    };

    // دریافت مدیای کاربر مقابل
    pc.ontrack = event => {
        addRemoteVideo(peerId, event.streams[0]);
    };

    // ایجاد Offer فقط اگر آغازگر باشیم
    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', target: peerId, offer: offer }));
        }).catch(err => console.error("Error creating offer:", err));
    }
    return pc;
}

async function handleOffer(message) {
    const pc = createPeerConnection(message.sender || message.client_id || message.target, false);
    // چون پیام Offer را ما از طریق سرور دریافت کردیم، آیدی فرستنده را استخراج می‌کنیم
    // بک‌اند پایتون فعلی آیدی فرستنده اصلی را مستقیماً در تارگت نمی‌گذارد، بنابراین در handleOffer سرور باید فرستنده را مشخص می‌کردیم.
    // نکته: برای دقت بیشتر، بهتر است فرستنده اصلی را از متغیرها بگیریم. در اینجا فرض می‌کنیم پیام حاوی فرستنده است.
    
    // *اصلاحیه کلاینت ساید برای تطابق با بک‌اند پایتون:* // بک‌اند پیام را عیناً می‌فرستد. پس ما باید مطمئن شویم در زمان ارسال Offer، آیدی خودمان را هم بفرستیم.
}

// اصلاح توابع هندلینگ بر اساس معماری سوکت:
async function handleOffer(message) {
    const peerId = message.senderId;
    const pc = createPeerConnection(peerId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', target: peerId, answer: answer, senderId: clientId }));
}

async function handleAnswer(message) {
    const pc = peerConnections[message.senderId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
    }
}

async function handleIceCandidate(message) {
    const pc = peerConnections[message.senderId];
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
}

// *تغییر مهم در createPeerConnection برای ارسال senderId:*
function createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ice-candidate', target: peerId, candidate: event.candidate, senderId: clientId }));
        }
    };

    pc.ontrack = event => {
        addRemoteVideo(peerId, event.streams[0]);
    };

    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', target: peerId, offer: offer, senderId: clientId }));
        });
    }
    return pc;
}

// --- مدیریت رابط کاربری ویدیوها ---
function addRemoteVideo(peerId, stream) {
    if (document.getElementById(`video-${peerId}`)) return;
    
    const container = document.createElement('div');
    container.id = `container-${peerId}`;
    container.style.textAlign = "center";
    
    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    
    container.appendChild(video);
    container.appendChild(document.createElement('br'));

    // اضافه کردن دکمه‌های کنترلی برای مدیر
    if (myRole === 'admin') {
        const muteMicBtn = document.createElement('button');
        muteMicBtn.innerText = 'قطع میکروفون';
        muteMicBtn.style.backgroundColor = '#d32f2f';
        muteMicBtn.onclick = () => ws.send(JSON.stringify({ type: 'admin-action', action: 'mute-mic', target_id: peerId }));
        
        const muteCamBtn = document.createElement('button');
        muteCamBtn.innerText = 'بستن تصویر';
        muteCamBtn.style.backgroundColor = '#f57c00';
        muteCamBtn.onclick = () => ws.send(JSON.stringify({ type: 'admin-action', action: 'mute-cam', target_id: peerId }));

        container.appendChild(muteMicBtn);
        container.appendChild(muteCamBtn);
    } else {
        const label = document.createElement('span');
        label.innerText = `کاربر ${peerId.substring(0,4)}`;
        container.appendChild(label);
    }

    document.getElementById('video-grid').appendChild(container);
}

function removeUserVideo(peerId) {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    const container = document.getElementById(`container-${peerId}`);
    if (container) container.remove();
}

// --- کنترل‌های مدیا کاربر ---
function toggleAudio(forceMute = false) {
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = forceMute ? false : !track.enabled;
        if (forceMute) alert("مدیر میکروفون شما را قطع کرد.");
    }
}

function toggleVideo(forceMute = false) {
    const track = localStream.getVideoTracks()[0];
    if (track) {
        track.enabled = forceMute ? false : !track.enabled;
        if (forceMute) alert("مدیر دوربین شما را بست.");
    }
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // جایگزین کردن ترک ویدیو در تمام اتصالات P2P
            for (let id in peerConnections) {
                const sender = peerConnections[id].getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
            }
            
            document.getElementById('local-video').srcObject = screenStream;
            isScreenSharing = true;

            // برگشت به وب‌کم هنگام توقف شیر اسکرین
            screenTrack.onended = () => {
                const videoTrack = localStream.getVideoTracks()[0];
                for (let id in peerConnections) {
                    const sender = peerConnections[id].getSenders().find(s => s.track.kind === 'video');
                    if (sender) sender.replaceTrack(videoTrack);
                }
                document.getElementById('local-video').srcObject = localStream;
                isScreenSharing = false;
            };
        } catch (error) {
            console.error("Screen sharing canceled or failed", error);
        }
    }
}

// --- چت ---
function sendChat() {
    const input = document.getElementById('chat-input');
    if (input.value.trim() !== '') {
        ws.send(JSON.stringify({ type: 'chat', text: input.value }));
        
        // نمایش پیام خودمان
        appendChat({ sender: 'شما', role: myRole, text: input.value });
        input.value = '';
    }
}

// ارسال پیام با زدن دکمه Enter
document.getElementById('chat-input')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendChat();
});

function appendChat(msg) {
    const chatBox = document.getElementById('chat-messages');
    let senderName = msg.sender === 'شما' ? 'شما' : (msg.role === 'admin' ? 'مدیر' : `کاربر ${msg.sender.substring(0,4)}`);
    
    chatBox.innerHTML += `<p style="margin: 5px 0;"><b>${senderName}:</b> ${msg.text}</p>`;
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- دستورات مدیر ---
function endCall() {
    if (confirm("آیا از پایان دادن به کنفرانس برای همه مطمئن هستید؟")) {
        ws.send(JSON.stringify({ type: 'admin-action', action: 'end-call' }));
    }
}
