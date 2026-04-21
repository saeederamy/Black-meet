let ws;
let localStream;
let peerConnections = {};
const configuration = { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] };
const clientId = Math.random().toString(36).substring(7);
let myRole = 'user';
let isScreenSharing = false;

async function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    
    // شبیه‌سازی لاگین ساده (در واقعیت باید با API احراز هویت شود)
    myRole = (user === 'admin' && pass === 'admin') ? 'admin' : 'user';
    document.getElementById('role-display').innerText = myRole;
    
    if (myRole === 'admin') {
        document.getElementById('admin-controls').style.display = 'inline';
    }

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('meet-screen').style.display = 'block';

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;

    connectWebSocket();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${clientId}/${myRole}`);

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'user-joined') {
            createPeerConnection(message.client_id, true);
        } else if (message.type === 'offer') {
            handleOffer(message);
        } else if (message.type === 'answer') {
            handleAnswer(message);
        } else if (message.type === 'ice-candidate') {
            handleIceCandidate(message);
        } else if (message.type === 'user-left') {
            removeUserVideo(message.client_id);
        } else if (message.type === 'chat') {
            appendChat(message);
        } else if (message.type === 'call-ended') {
            alert('ادمین به جلسه پایان داد.');
            location.reload();
        } else if (message.type === 'force-action') {
            if (message.action === 'mute-mic') toggleAudio(true);
            if (message.action === 'mute-cam') toggleVideo(true);
        }
    };
}

function createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ice-candidate', target: peerId, candidate: event.candidate }));
        }
    };

    pc.ontrack = event => {
        addRemoteVideo(peerId, event.streams[0]);
    };

    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', target: peerId, offer: offer }));
        });
    }
    return pc;
}

async function handleOffer(message) {
    const pc = createPeerConnection(message.sender, false);
    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', target: message.sender, answer: answer }));
}

async function handleAnswer(message) {
    const pc = peerConnections[message.sender];
    await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
}

async function handleIceCandidate(message) {
    const pc = peerConnections[message.sender];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
}

function addRemoteVideo(peerId, stream) {
    if (document.getElementById(`video-${peerId}`)) return;
    const container = document.createElement('div');
    container.id = `container-${peerId}`;
    
    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    
    container.appendChild(video);

    // دکمه‌های کنترل برای ادمین روی ویدیوی بقیه
    if (myRole === 'admin') {
        const kickBtn = document.createElement('button');
        kickBtn.innerText = 'قطع میکروفون';
        kickBtn.onclick = () => ws.send(JSON.stringify({ type: 'admin-action', action: 'mute-mic', target_id: peerId }));
        container.appendChild(document.createElement('br'));
        container.appendChild(kickBtn);
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

// --- مدیا کنترل ---
function toggleAudio(forceMute = false) {
    const track = localStream.getAudioTracks()[0];
    track.enabled = forceMute ? false : !track.enabled;
}

function toggleVideo(forceMute = false) {
    const track = localStream.getVideoTracks()[0];
    track.enabled = forceMute ? false : !track.enabled;
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        for (let id in peerConnections) {
            const sender = peerConnections[id].getSenders().find(s => s.track.kind === 'video');
            sender.replaceTrack(screenTrack);
        }
        document.getElementById('local-video').srcObject = screenStream;
        isScreenSharing = true;

        screenTrack.onended = () => {
            const videoTrack = localStream.getVideoTracks()[0];
            for (let id in peerConnections) {
                const sender = peerConnections[id].getSenders().find(s => s.track.kind === 'video');
                sender.replaceTrack(videoTrack);
            }
            document.getElementById('local-video').srcObject = localStream;
            isScreenSharing = false;
        };
    }
}

// --- چت ---
function sendChat() {
    const input = document.getElementById('chat-input');
    if (input.value.trim() !== '') {
        ws.send(JSON.stringify({ type: 'chat', text: input.value }));
        input.value = '';
    }
}

function appendChat(msg) {
    const chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML += `<p><b>${msg.role === 'admin' ? 'ادمین' : 'کاربر'} (${msg.sender.substring(0,4)}):</b> ${msg.text}</p>`;
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- ادمین ---
function endCall() {
    ws.send(JSON.stringify({ type: 'admin-action', action: 'end-call' }));
}
