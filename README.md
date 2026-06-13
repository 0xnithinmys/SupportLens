# SupportLens

A real-time video support platform for customer service agents. Agents can create sessions, invite customers via a shareable link, conduct live video calls, record meetings, and manage participants — all from a single dashboard.

## Features

- 🎥 **Real-time Video Calls** — WebRTC via mediasoup SFU for low-latency, multi-party video
- 🎙️ **Audio Mixing** — All participant audio merged into one clear recording track
- 📹 **Session Recording** — Server-side recording with grid video layout and S3 upload
- 💬 **In-Call Chat** — Real-time text chat and file sharing during calls
- 🔴 **Admin Controls** — Mute all, remove participants, end call for everyone
- 📊 **Dashboard** — Manage sessions, view recordings, track participants
- 📡 **Observability** — Prometheus metrics + Grafana dashboards

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Node.js, Express, Socket.io, TypeScript |
| WebRTC | mediasoup (SFU) |
| Recording | FFmpeg (server-side compositing) |
| Database | PostgreSQL (Supabase) |
| Queue | BullMQ + Redis |
| Storage | AWS S3 |
| Proxy | Nginx |
| Monitoring | Prometheus + Grafana |

## Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- Redis (running on port 6379)
- FFmpeg installed on your system
- PostgreSQL database

### 1. Clone the repo
```bash
git clone https://github.com/0xnithinmys/SupportLens.git
cd SupportLens
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure the server
Copy the example env file and fill in your values:
```bash
cp server/.env.production.example server/.env
```

Edit `server/.env` with your database URL, JWT secret, S3 credentials, etc.

> **Important:** Set `MEDIASOUP_ANNOUNCED_IP` to your machine's local IP (e.g. `192.168.x.x`) for WebRTC to work correctly.

### 4. Run the development servers
```bash
# Start the backend
npm run dev --workspace=server

# Start the frontend (in a second terminal)
npm run dev --workspace=client
```

The app will be available at `http://localhost:5173`.

## Production Deployment

See `server/.env.production.example` for all required environment variables.

Key production requirements:
- Set `MEDIASOUP_ANNOUNCED_IP` to your server's **public IP**
- Set `CLIENT_URL` to your production domain (e.g. `https://yourdomain.com`)
- Install FFmpeg on the server: `sudo apt install -y ffmpeg`
- Open firewall ports: **TCP 443** (HTTPS) and **UDP 10000–10500** (WebRTC)
- Run with Docker Compose (Redis, Nginx, Certbot included)

## License

MIT
