<div align="center">

# 🎯 SupportLens
### Real-Time Video Support Platform — Self-Hosted & Zero Vendor Lock-In

[![Node.js](https://img.shields.io/badge/Node.js-20-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?style=flat-square&logo=react)](https://react.dev)
[![Mediasoup](https://img.shields.io/badge/Mediasoup-3.x-orange?style=flat-square)](https://mediasoup.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169e1?style=flat-square&logo=postgresql)](https://supabase.com)
[![Redis](https://img.shields.io/badge/Redis-Pub%2FSub-red?style=flat-square&logo=redis)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker)](https://docker.com)

</div>

---

## 1. 📋 Project Title

**SupportLens** — A fully proprietary, self-hosted WebRTC real-time video calling platform engineered specifically for enterprise customer support workflows. No Twilio. No Agora. No vendor lock-in. Everything runs on your own infrastructure.

---

## 2. 🚨 Problem Statement

The customer support industry is currently undergoing a structural paradigm shift, transitioning from traditional, low-bandwidth voice and text-based interactions toward visually contextualized, real-time video resolutions. In high-stakes environments—such as field engineers troubleshooting complex hardware, agents guiding non-technical customers through convoluted software interfaces, or technicians verifying physical installations—voice channels frequently fail, leading to unresolved support tickets, escalating operational costs, and elevated customer frustration.

However, bolting on third-party WebRTC platforms (such as Twilio Video, Agora, Vonage, or Daily) introduces unacceptable trade-offs for enterprise support teams. These SDKs create **deep vendor lock-in**, **limit low-level architectural control**, **impose recurring variable costs that scale linearly with usage**, and crucially, force highly sensitive customer support interactions to traverse **external, third-party infrastructure**.

To overcome these constraints, SupportLens engineers a self-hosted, proprietary WebRTC platform that natively incorporates session management, real-time media routing, synchronous in-call chat, strict role-based access control (RBAC), advanced telemetry, server-side media recording, file sharing, and state-recovered reconnections — while remaining completely independent of third-party video APIs.

---

## 3. 🌐 Live Demo

| Component | URL |
|---|---|
| **Platform (Frontend + API)** | `http://16.171.22.54` |
| **Health Check** | `http://16.171.22.54/api/health` |

---

## 4. 🔐 Demo Credentials

| Role | Email | Password | Access Level |
|---|---|---|---|
| **Admin** | `admin@atomquest.dev` | `Admin@123` | Global session view, force-terminate any session, all agent capabilities |
| **Agent** | `agent@atomquest.dev` | `Agent@123` | Create sessions, generate invite links, manage own calls, record |
| **Customer** | *(no login)* | *(no password)* | Joins via ephemeral UUID invite link — zero account required |

> 💡 Customer access is completely ephemeral. The invite link UUID **is** the access token, validated server-side on every WebSocket event.

---

## 5. ✅ Features Implemented

### 🔑 Authentication & RBAC
- **JWT-based login** with Argon2 password hashing — industry-standard credential security.
- Socket.io auth middleware validates tokens on **every single WebSocket event** (not just connection). Malicious clients emitting privileged events like `agent:end_session` from a CUSTOMER role are **rejected, disconnected, and security-logged** to the database.
- Three role tiers enforced both in REST middleware (`requireRole`) and socket guards (`guardRole`): `CUSTOMER`, `AGENT`, `ADMIN`.

### 📊 Agent Dashboard
- Lists complete session history via `GET /api/sessions/history` with **paginated results** (up to 50 per page).
- Displays per-participant durations calculated via `EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at))`.
- **"New Session"** button calls `POST /api/sessions`, creates a `WAITING` record in PostgreSQL, and returns a shareable cryptographically-secure invite URL (`/join/{uuid}`).
- Admins see **all sessions globally**; Agents see only their own.

### 🔗 Customer Pre-Flight & Waiting Room
- Customer navigates to `/join/{uuid}` — **no account, no login required**.
- The UUID is validated server-side against the PostgreSQL `sessions` table on every socket event.
- Pre-flight page runs `navigator.mediaDevices.getUserMedia()` hardware checks — OS-enforced browser permission dialogs prevent silent capture.
- Customer waits in the waiting room until the Agent's socket joins and the session status transitions from `WAITING` → `ACTIVE`.

### 📹 Active Call Interface
- **Dynamic Media Grid:** Renders `<video>` and `<audio>` DOM elements per active Mediasoup Consumer. Handles muted/disabled tracks with overlay states.
- **Control Dock:** Mic toggle, camera toggle, screen share (`getDisplayMedia()`), recording control, and End Session — all guarded by role checks.
- **Screen Sharing:** Emits as a separate producer with `appData.source = 'screen'`, rendered as a distinct tile in the media grid.
- **Auxiliary Drawer:** Collapsible panel with real-time chat, file sharing, and participant list.

### 💬 Real-Time Chat & Persistence
- `chat:send` → DB insert → `chat:receive` broadcast. Every message is **committed to PostgreSQL before delivery**. Network failures cannot produce phantom messages.
- `is_file` flag allows file URLs to render as inline previews or download links rather than plain text.
- Full chat transcript is queryable post-call via `GET /api/sessions/:id`.

### 📂 File Sharing
- `POST /api/files/upload` accepts `multipart/form-data` and **streams directly to AWS S3** without buffering in Node.js memory — critical for large diagnostic files like PDF manuals or system logs.
- Returns a secure S3 URL which is emitted as a `chat:send` event with `is_file: true`.

### 🛡 Admin Dashboard
- Reads live participant state from **Redis** to display a global real-time list of all active sessions across the platform.
- **Force Terminate:** Calls `POST /api/sessions/:id/end`, which broadcasts `room:closed`, disconnects all sockets, closes all Mediasoup transports, frees C++ worker memory, stamps `left_at` on all participants, and kills any active FFmpeg recording processes.

### 🔄 Reconnect Handling (Two-Tier)
- **Tier 1 — Socket.io Connection State Recovery:** `maxDisconnectionDuration: 120_000ms`. Server retains socket state and missed events for 2 minutes. Client reconnects seamlessly with original session ID.
- **Tier 2 — WebRTC ICE Restart:** Client monitors `RTCPeerConnection.iceConnectionState`. On `failed` or `disconnected`, fires `transport:restartIce` via the recovered WebSocket, generating fresh ICE credentials without notifying the other party.

### 🧹 Zombie Session Cleanup (Heartbeat)
- Server emits `heartbeat:ping` every **20 seconds** to every connected socket. After **3 consecutive missed pongs**, the server initiates full cascading teardown: closes Mediasoup transports, clears Redis state, updates PostgreSQL `left_at`, and sends `SIGKILL` to any orphaned FFmpeg processes.

### 📈 Telemetry & Observability
- Client polls `RTCPeerConnection.getStats()` every 3 seconds and emits `telemetry:media` with `rtt`, `jitter`, and `packetLossFraction` (calculated as delta between polling intervals).
- Server ingests these samples via `recordMediaSample()` and exposes them on `GET /metrics` formatted for **Prometheus**. Ready for Grafana dashboard visualization.

---

## 6. ⭐ Bonus Features

### 🎙 Dual-Mode Session Recording
- **Mode A — Server-Side via Mediasoup PlainTransport + FFmpeg:** When `agent:start_recording` is received, the server creates a `PlainTransport` per producer (bypassing DTLS-SRTP), generates a custom SDP file with exact payload type mappings (e.g., Opus at PT:111), and spawns an FFmpeg child process per track. On stop, a **Redis BullMQ job** (`recording-mux` queue) muxes audio + video tracks using `amix` and `hstack` FFmpeg filters, then uploads the final `final.webm` to S3. The `recording_url` in PostgreSQL is updated automatically.
- **Mode B — Client-Side High-Fidelity via MediaRecorder:** Agent triggers `getDisplayMedia()` in the browser. The `MediaRecorder` captures the exact full visual layout (all tiles, screen share) and all mixed audio directly into a `.webm` file. On stop, the file is uploaded to `POST /api/files/upload` and saved to the session via `POST /api/sessions/:id/recording`.

### 🔒 Distributed Mutex for Duplicate Joins
- On every `room:join` event, the server performs an **atomic Redis `SET NX PX`** lock on `lock:room:{roomId}:user:{userId}`. Only the first request acquires the lock; concurrent duplicate tabs receive an error. The server also **evicts any existing socket** for the same `userId` already in the room, ensuring exactly one active media pipeline per participant at all times.

### 📡 Distributed Signaling with Redis Adapter
- `@socket.io/redis-adapter` is initialized with **two dedicated Redis connections** (one pub, one sub — as required by the adapter spec). This solves the split-brain problem: a `socket.to(roomId).emit()` on Node 1 correctly reaches a client connected to Node 3 via Redis Pub/Sub broadcast.
- Gracefully falls back to single-node mode if Redis is unavailable at startup.

### 🔐 Security Headers via Nginx
- Full TLS termination: `TLSv1.2` and `TLSv1.3` only.
- `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` headers enforced on every response.
- WebSocket upgrades are explicitly proxied with `Upgrade` and `Connection` headers. HTTP is permanently redirected to HTTPS (301).

### 📊 Security Audit Logging
- Every RBAC violation on the socket layer is logged to the database via `logSecurityEvent()`, capturing: `socketId`, `sessionId`, `userId`, `displayName`, `role`, and the `allowedRoles` that were required.

---

## 7. 🏗 Architecture Diagram

```mermaid
flowchart TD
    Customer["👤 Customer Browser"] -->|HTTPS / WSS| Nginx["🔀 Nginx Reverse Proxy\nTLS Termination + Security Headers"]
    Agent["🧑‍💼 Agent / Admin Browser"] -->|HTTPS / WSS| Nginx

    subgraph Server Infrastructure on AWS EC2
        Nginx -->|REST /api/| Node["⚙️ Node.js Express\nJWT Auth · RBAC · Socket.io"]
        Nginx -->|WSS /socket.io/| Node
        Node -->|Round-Robin| Mediasoup["🎬 Mediasoup C++ Workers\nSFU · VP8 · H264 · Opus"]
        Customer -->|RTP/RTCP over UDP/TCP| Mediasoup
        Agent -->|RTP/RTCP over UDP/TCP| Mediasoup
        Node -->|BullMQ Jobs| Worker["🔧 FFmpeg Mux Worker\nRecording Pipeline"]
    end

    subgraph Data Layer
        Node <-->|"Pub/Sub · Atomic Locks\nSession State"| Redis[("🔴 Redis")]
        Node <-->|"ACID Transactions\nUsers · Sessions · Chat"| Supabase[("🐘 Supabase PostgreSQL")]
        Node -->|"Multipart Stream\nFiles + Recordings"| S3[("☁️ AWS S3")]
        Worker -->|Upload final.webm| S3
        Worker -->|Update recording_url| Supabase
    end
```

---

## 8. 📡 Media Routing Compliance

SupportLens is built **strictly** on a **Selective Forwarding Unit (SFU)** topology using Mediasoup v3.

| Topology | Approach | Why Rejected |
|---|---|---|
| **P2P Mesh** | Each peer sends to every other peer | Exponential bandwidth — fails beyond 2-3 participants |
| **MCU** | Server decodes and re-encodes a composite stream | Extreme server CPU cost, high latency |
| **SFU ✅** | Server routes RTP packets without decoding | Optimal: single upload per client, server just forwards |

**Implementation specifics from code:**
- Workers are spawned at startup: `Math.min(os.cpus().length, MEDIASOUP_WORKERS)` — scales with server CPU.
- Each room gets its own `Router` via round-robin worker selection.
- Codecs supported: `audio/opus` (48kHz, stereo, FEC), `video/VP8`, `video/H264` (packetization-mode 1, profile 42e01f).
- Direct peer-to-peer connections are **structurally impossible** — SDP offers are never relayed to other clients.

### WebSocket Event Dictionary

| Event | Direction | Purpose |
|---|---|---|
| `room:join` | Client → Server | Join room, validate session, acquire Redis mutex lock |
| `router:capabilities` | Server → Client | Send Mediasoup RTP capabilities for codec negotiation |
| `transport:create` | Client ↔ Server | Create WebRtcTransport (UDP + TCP), exchange ICE/DTLS params |
| `transport:connect` | Client → Server | Complete DTLS handshake — establishes secure media tunnel |
| `transport:restartIce` | Client → Server | Restart ICE on network change — generates fresh credentials |
| `produce` | Client → Server | Announce new media track (audio/video/screen) |
| `consume` | Client → Server | Request to receive a specific producer's stream |
| `consumer:resume` | Client → Server | Unpause consumer after track setup |
| `newProducer` | Server → Client | Notify peers of new or closed producer |
| `chat:send` | Client → Server | Send message — persisted to DB before broadcast |
| `chat:receive` | Server → Client | Broadcast persisted message to all room members |
| `agent:start_recording` | Client → Server | Start FFmpeg recording (Agent/Admin only) |
| `agent:stop_recording` | Client → Server | Stop recording and enqueue BullMQ mux job |
| `agent:end_session` | Client → Server | Cascading teardown of all room resources |
| `agent:mute_all` | Client → Server | Force-mute all other participants |
| `agent:remove_participant` | Client → Server | Kick a specific participant by socketId |
| `telemetry:media` | Client → Server | RTT, jitter, packet loss fraction metrics |
| `heartbeat:ping` | Server → Client | Liveness probe every 20s |
| `heartbeat:pong` | Client → Server | Response to liveness probe |
| `room:closed` | Server → Client | Broadcast room teardown to all members |
| `recording:status` | Server → Client | Notify all participants of recording state change |
| `room:force_mute` | Server → Client | Force client to mute microphone |
| `room:kicked` | Server → Client | Notify participant they were removed |

---

## 9. 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** (TypeScript / TSX) | SPA framework |
| **Vite** | Lightning-fast build tooling |
| **TailwindCSS** | Utility-first styling |
| **shadcn/ui + lucide-react** | Premium UI components & icons |
| **socket.io-client** | Real-time WebSocket communication |
| **mediasoup-client** | WebRTC device management & transport setup |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js 20 + TypeScript** | Server runtime |
| **Express.js** | REST API framework |
| **socket.io v4** | WebSocket server with Connection State Recovery |
| **mediasoup v3** | C++ SFU workers — VP8, H264, Opus codecs |
| **argon2** | Password hashing (industry standard) |
| **jsonwebtoken** | JWT auth for agents and admins |
| **bullmq** | Redis-backed job queue for recording mux |
| **ffmpeg** | Server-side RTP recording and muxing |

### Infrastructure & Database
| Technology | Purpose |
|---|---|
| **PostgreSQL** (Supabase) | ACID-compliant durable data store |
| **Redis** | Pub/Sub signaling, distributed mutex locks, BullMQ |
| **AWS S3** | Object storage for files and recordings |
| **Docker + Docker Compose** | Containerized production deployment |
| **Nginx** | Reverse proxy, TLS termination, WebSocket upgrade |
| **AWS EC2** (Ubuntu) | Cloud hosting |

---

## 10. ⚙️ Setup Instructions

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- An AWS S3 bucket (or local MinIO)
- A Supabase or self-hosted PostgreSQL instance

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/0xnithinmys/SupportLens.git
cd SupportLens

# 2. Install all dependencies
npm install --prefix client
npm install --prefix server

# 3. Start local infrastructure (Redis + MinIO)
docker compose up -d redis minio

# 4. Configure environment variables
cp server/.env.production.example server/.env
# Edit server/.env with your DB, Redis, S3 credentials

# 5. Apply database migrations
npm run db:migrate --prefix server

# 6. Seed default users (admin + agent)
npm run db:seed --prefix server

# 7. Start development servers
npm run dev --prefix server    # Terminal 1 — backend on :4000
npm run dev --prefix client    # Terminal 2 — frontend on :5173
```

---

## 11. 🚀 Deployment

The platform is fully containerized and deployed on **AWS EC2** using Docker Compose and Nginx.

```
Internet
    │
    ▼
Nginx (port 80/443)
    │── HTTP → 301 HTTPS redirect
    │── /         → Serves React SPA static files (/var/www/html)
    │── /api/     → Proxied to Node.js :4000
    │── /socket.io/ → WebSocket proxied to Node.js :4000 (Upgrade header set)
    └── /metrics  → Proxied to Node.js :4000 (Prometheus endpoint)
```

**Deploy to production:**
```bash
# On the EC2 instance
git pull origin main
docker compose up -d --build
```

**Build and copy frontend manually:**
```bash
# Local machine
npm run build --prefix client
scp -r client/dist ubuntu@<EC2_IP>:/var/www/html
```

---

## 12. 🔑 Environment Variables

### Backend `/server/.env`

```env
# Server
PORT=4000
NODE_ENV=production
CLIENT_URL=http://16.171.22.54

# Database
DATABASE_URL=postgresql://postgres:[PASSWORD]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379

# JWT
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# AWS S3 / MinIO Object Storage
S3_ENDPOINT=s3.eu-north-1.amazonaws.com
S3_PORT=443
S3_USE_SSL=true
S3_ACCESS_KEY=your_aws_access_key_id
S3_SECRET_KEY=your_aws_secret_access_key
S3_BUCKET=atomquest-production-files
S3_REGION=eu-north-1
S3_PUBLIC_URL=https://atomquest-production-files.s3.eu-north-1.amazonaws.com

# Mediasoup
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=16.171.22.54   # Public EC2 IP — MUST match for ICE
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
MEDIASOUP_WORKERS=2

# Recording
RECORDING_DIR=/app/recordings
RECORDING_RTP_PORT=5004
FFMPEG_PATH=ffmpeg
```

### Frontend `/client/.env`

```env
VITE_API_URL=http://16.171.22.54/api
```

---

## 13. 📁 Repository Structure

```text
SupportLens/
├── client/                         # React 18 SPA (Vite + TypeScript)
│   ├── src/
│   │   ├── api/                    # Axios REST client + file upload helpers
│   │   ├── components/             # shadcn/ui reusable component library
│   │   ├── pages/
│   │   │   ├── Login.tsx           # JWT authentication form
│   │   │   ├── Dashboard.tsx       # Agent session history + invite link gen
│   │   │   ├── AdminDashboard.tsx  # Global session view + force-terminate
│   │   │   ├── JoinRoom.tsx        # Customer pre-flight & waiting room
│   │   │   └── CallRoom.tsx        # Active call: media grid, chat, controls
│   │   └── lib/                    # WebRTC utility helpers
│   └── vite.config.ts              # Vite build + API proxy config
│
├── server/                         # Node.js backend (TypeScript)
│   ├── src/
│   │   ├── app.ts                  # Express app factory
│   │   ├── index.ts                # Server entrypoint
│   │   ├── config/
│   │   │   ├── db.ts               # PostgreSQL connection pool
│   │   │   ├── redis.ts            # Redis (ioredis) client
│   │   │   ├── mediasoup.ts        # Worker pool + Router factory (VP8, H264, Opus)
│   │   │   └── storage.ts          # AWS S3 / MinIO client
│   │   ├── db/
│   │   │   ├── migrate.ts          # Schema migration runner
│   │   │   └── seed.ts             # Default user seeder (admin + agent)
│   │   ├── middleware/
│   │   │   └── auth.middleware.ts  # requireAuth / requireRole JWT guards
│   │   ├── routes/
│   │   │   ├── auth.routes.ts      # POST /api/auth/login, GET /api/auth/me
│   │   │   ├── sessions.routes.ts  # Session CRUD + /end + /recording
│   │   │   └── files.routes.ts     # POST /api/files/upload → S3 stream
│   │   ├── services/
│   │   │   ├── recording.ts        # PlainTransport + FFmpeg + BullMQ mux pipeline
│   │   │   ├── metrics.ts          # Prometheus /metrics endpoint + telemetry ingestion
│   │   │   └── security.ts         # Security event audit logger
│   │   └── socket/
│   │       └── index.ts            # Full Socket.io server — auth, RBAC, all events
│   ├── Dockerfile                  # Multi-stage build (builder → production)
│   └── package.json
│
├── nginx/
│   └── atomquest.conf              # Nginx: TLS, SPA serving, API/WS proxy, security headers
├── docker-compose.yml              # Production multi-container orchestration
├── README.md
└── script.md                       # 3-minute demo video script
```

---

## 14. ⚠️ Known Limitations

- **TURN Server Not Deployed:** The platform relies on Mediasoup's announced IP for ICE. Connections from extremely strict corporate firewalls or symmetric NATs may fail to establish media pathways. A Coturn deployment would solve this.
- **Client-Side Recording Dependency:** Mode B recording (MediaRecorder) requires the Agent to manually select the correct tab and check the **"Share audio"** checkbox in the browser prompt. Automation requires a server-side headless approach.
- **Single EC2 Node:** The current deployment runs on a single instance. Horizontal scaling (multiple Node.js pods) requires a load balancer with sticky sessions or consistent hashing for Socket.io.

---

## 15. 🔮 Future Improvements

- **Coturn / TURN Server:** Deploy and configure a Coturn relay server to guarantee connectivity for all network topologies, including symmetric NATs and enterprise firewalls.
- **Server-Side Headless Recording:** Migrate to a GStreamer/Puppeteer-based virtual framebuffer to automate full recording composition without any agent interaction.
- **AI Post-Call Intelligence:** Integrate Whisper (speech-to-text) for automatic call transcription, combined with LLM-based sentiment analysis and smart summary generation for agents.
- **Horizontal Scaling:** Add an Nginx load balancer with Redis-backed sticky session routing to allow multiple Node.js instances behind a single entry point.
- **End-to-End Tests:** Integration tests covering session creation, multi-participant join, chat persistence, recording pipeline, and reconnect recovery flows using Playwright.

---

## 16. 👤 Team Information

| Name | Email |
|---|---|
| **Nithin N** | nithin958595@gmail.com |

---

<div align="center">

Built for the **AtomQuest Hackathon** · Self-hosted WebRTC · Zero Vendor Lock-In

⭐ Star this repo if you found it useful!

</div>
