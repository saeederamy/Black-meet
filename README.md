# 🚀 Black Meet - Ultimate Enterprise Video Conferencing

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange.svg)
![License](https://img.shields.io/badge/License-MIT-success.svg)

**Black Meet** is a high-performance, ultra-low latency, and fully responsive WebRTC video conferencing platform. Built with **FastAPI (Python)** and **Vanilla JS**, it delivers a premium Google Meet/Zoom-like experience. 

🌍 **Optimized for Restricted Networks:** This project uses **Zero External Dependencies** (No Google Fonts, no external CDNs, and inline SVGs). It is specifically designed to load at lightning speed on restricted networks and internal intranets.

---

## ✨ Key Features

* 🎥 **Crystal Clear Audio/Video:** True P2P communication via WebRTC.
* 💻 **Independent Screen Sharing:** Share your screen alongside your webcam in a separate, dedicated video capsule without any conflicts.
* 🎙️ **AI Active Speaker Detection:** Microphones dynamically glow green using `AudioContext` when a user is speaking.
* 🔴 **Built-in Session Recording (DVR):** Admins can record the entire meeting directly from the browser and download the `.mp4` file instantly.
* 👑 **Advanced Admin Controls:** * Force-mute microphones & block cameras.
    * Pause the entire meeting (Sends users to a waiting room overlay).
    * Clear global chat history for all users.
* 💬 **Real-time Terminal Chat:** Includes chat history and history download capabilities.
* 📱 **Dynamic Grid System:** Auto-scaling video grid that perfectly adapts from 1 to 10+ users on both Desktop and Mobile.
* 🔲 **Native Fullscreen & PiP:** Hardware-accelerated fullscreen with floating Picture-in-Picture for your own webcam.
* 🔒 **Secure Authentication:** Role-based login (Admin/User).

---

## 🎨 UI/UX Highlights
* **Glossy Glassmorphism:** Deep blacks, translucent panels, and vibrant neon accents (Blue, Red, Orange).
* **Sidebar Navigation:** Tabbed sidebar for Chat, Active Users, and Admin DVR controls.
* **Avatar Bubbles:** Automatically displays a sleek initial-based avatar when a user turns off their camera.

---

## ⚡ Easy Installation (One-Liner)

If your server has access to the global internet, you can install, configure, and secure the app with a single command. Run this in your Ubuntu root terminal:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/saeederamy/black-meet/main/install.sh)
```
