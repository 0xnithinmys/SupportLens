# 🎬 SupportLens — 3-Minute Demo Script

> **Total Time:** ~3 minutes  
> **Setup before recording:**
> - **Tab 1 (Agent):** `http://16.171.22.54` — logged in as `agent@atomquest.dev`
> - **Tab 2 (Customer):** Incognito window — paste invite link here
> - **Tab 3 (Admin):** `http://16.171.22.54` — logged in as `admin@atomquest.dev`
> - **Tab 4:** GitHub README open at the Architecture Diagram section
>
> **💡 Pro Tip:** Use split-screen with Agent + Customer side-by-side for the call section. It visually proves real-time media routing.

---

## 🟢 INTRO — [0:00 – 0:18]

> *(Show the SupportLens login page fullscreen)*

**Say:**
> "This is **SupportLens** — a fully self-hosted, proprietary WebRTC video support platform. No Twilio, no Agora, zero vendor lock-in. Everything — the media routing, the signaling, the recording, the storage — runs on our own AWS EC2 infrastructure using Mediasoup, Node.js, React, Redis, and PostgreSQL. Let me show you everything."

---

## 🔑 STEP 1 — Agent Login & Dashboard [0:18 – 0:42]

> *(Log in as Agent)*

**Action:**
- Type `agent@atomquest.dev` / `Agent@123` → **Login**
- The Agent Dashboard loads showing past sessions with durations

**Say:**
> "Agents log in via JWT — passwords are Argon2 hashed. The dashboard fetches paginated session history from PostgreSQL, showing duration per participant calculated at the database level."

**Action:**
- Click **"New Session"** → an invite link appears

**Say:**
> "Clicking New Session hits `POST /api/sessions`, creates a WAITING record in the DB, and returns a cryptographically secure invite URL. The UUID in that URL *is* the access token — no customer account needed."

---

## 👤 STEP 2 — Customer Joins [0:42 – 1:02]

> *(Copy the invite link → paste in incognito)*

**Action:**
- Open incognito, paste the invite URL
- Pre-flight page loads — browser asks for camera + mic

**Say:**
> "The customer navigates to the link. The pre-flight page runs `getUserMedia()` — the browser enforces OS-level hardware permission dialogs. We can't silently capture anything. Once hardware is checked..."

**Action:**
- Allow permissions → click **Join** → Waiting Room appears

**Say:**
> "...the customer waits. On the server, a Redis atomic lock is acquired to prevent any duplicate join race conditions. The session status stays WAITING until the Agent joins."

---

## 📹 STEP 3 — Live Call — Media Grid & Controls [1:02 – 1:35]

> *(Switch back to Agent tab → join the room → split screen Agent + Customer)*

**Action:**
- Agent joins → both video tiles appear in the Media Grid

**Say:**
> "Call is live. All media routes through our Mediasoup SFU — C++ workers forwarding RTP packets without re-encoding. VP8, H264, and Opus codecs. Direct peer-to-peer is structurally impossible — the server routes everything."

**Action:**
- Agent **mutes mic** → mute overlay appears on Agent tile for the Customer
- Agent **turns off camera** → camera-off overlay appears

**Say:**
> "Control Dock — mic toggle, camera toggle. State changes broadcast instantly across both sides via `newProducer` and `consumer:resume` socket events."

**Action:**
- Agent clicks **Screen Share** → picks a window → shared screen appears as a new tile

**Say:**
> "Screen sharing uses `getDisplayMedia()`. The browser requires an explicit OS-level selection dialog — you can see it appears as a distinct tile in the media grid."

---

## 💬 STEP 4 — Real-Time Chat & File Sharing [1:35 – 1:55]

> *(Open Auxiliary Drawer → Chat tab)*

**Action:**
- Agent types a message → hit Send
- Show it appear instantly on the Customer side

**Say:**
> "Every chat message hits `chat:send`, gets committed to PostgreSQL first, *then* broadcasts via Redis Pub/Sub to all room members. No phantom messages — if the server didn't write it, no one sees it."

**Action:**
- Click **file upload** → upload an image or PDF
- File link appears in chat on both sides

**Say:**
> "File sharing streams multipart uploads directly to AWS S3 without buffering in Node.js memory. The returned S3 URL is emitted as a chat message with `is_file: true` — rendered as an inline preview."

---

## 🎙 STEP 5 — Session Recording [1:55 – 2:12]

**Action:**
- Agent clicks the **Record** button
- Browser prompt appears → select the current tab → check **"Share audio"** → Share
- Recording indicator lights up

**Say:**
> "Recording uses a client-side `MediaRecorder` pipeline — it captures exactly what the agent sees and hears: all video tiles, the screen share, all participant audio — in one perfectly synced WebM file. When stopped, it auto-uploads to S3 and saves the URL to the session in the database."

---

## 🛑 STEP 6 — End Session [2:12 – 2:22]

**Action:**
- Agent clicks **End Session**
- Both tabs transition to "Call Ended"
- Session shows ENDED in the dashboard with correct end time

**Say:**
> "Ending the session triggers a cascading teardown: all Mediasoup transports close, Redis state is cleared, `left_at` is written to every participant in PostgreSQL, any FFmpeg recording process is killed with SIGKILL, and `room:closed` is broadcast to all sockets."

---

## 🛡 STEP 7 — Admin Dashboard & Security [2:22 – 2:42]

> *(Switch to Admin tab)*

**Action:**
- Admin Dashboard loads — shows global session list

**Say:**
> "The Admin Dashboard reads live participant state from Redis — real-time view of every active session on the platform, not just one agent's."

**Action:**
- Point to **Force Terminate** button on a session

**Say:**
> "Admins can force-terminate any session. And every attempt by a CUSTOMER to emit a privileged event — like `agent:end_session` — is rejected at the socket layer, the socket is disconnected, and the violation is written to an audit log in the database. RBAC is enforced server-side on every single event, not just on connection."

---

## 🏗 STEP 8 — Architecture Callout [2:42 – 2:55]

> *(Switch to GitHub README — Architecture Diagram)*

**Say:**
> "At the infrastructure level: React SPA served by Nginx, Node.js Express with Socket.io behind it, Mediasoup C++ SFU workers handling RTP, Redis for Pub/Sub and distributed mutex locks, Supabase PostgreSQL for durable data, AWS S3 for files and recordings — all running in Docker Compose on an AWS EC2 Ubuntu instance. Fully self-hosted, zero vendor dependency."

---

## ✅ OUTRO [2:55 – 3:00]

**Say:**
> "SupportLens — production-grade, self-hosted WebRTC. Thank you."

---

## 📋 Quick Reference Cheat Sheet

| Time | Action | Key Point to Say |
|---|---|---|
| 0:00–0:18 | Show login page | Self-hosted, no Twilio/Agora |
| 0:18–0:42 | Login as Agent, show Dashboard, generate invite | JWT + Argon2, paginated history, UUID invite URL |
| 0:42–1:02 | Customer joins via incognito link | No login, OS-enforced hardware permissions, Redis mutex |
| 1:02–1:35 | Both join call, show video tiles, mute/cam/screen share | Mediasoup SFU, VP8/H264/Opus, no P2P |
| 1:35–1:55 | Chat message + file upload | DB-first broadcast, S3 streaming |
| 1:55–2:12 | Click Record, share tab + audio | MediaRecorder, auto S3 upload |
| 2:12–2:22 | End Session | Cascading teardown, SIGKILL FFmpeg, DB stamped |
| 2:22–2:42 | Admin Dashboard, Force Terminate, RBAC | Redis live state, server-side RBAC on every event |
| 2:42–2:55 | GitHub README Architecture Diagram | Full stack callout |
| 2:55–3:00 | Closing line | — |
