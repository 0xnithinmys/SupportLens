/**
 * socket/index.ts
 * ----------------
 * Socket.io server with:
 *  ✓ Redis adapter — solves split-brain across horizontal Node.js cluster
 *  ✓ Auth middleware — JWT for agents/admins, session-UUID for customers
 *  ✓ Full Mediasoup signaling event dictionary (Tasks 5 & 6)
 *  ✓ RBAC guards enforced server-side
 *  ✓ Connection state recovery — 2-minute grace window (Task 14)
 *  ✓ Duplicate-join eviction
 *  ✓ Chat persistence & broadcast
 *  ✓ Heartbeat / disconnect cleanup
 */

import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { query } from '../config/db';
import redis from '../config/redis';
import { createRouter } from '../config/mediasoup';
import {
  killRecording,
  recordProducer,
  startRecording,
  stopRecording,
  isRecording,
} from '../services/recording';
import { recordMediaSample } from '../services/metrics';
import { logSecurityEvent } from '../services/security';
import type { Router, WebRtcTransport, Producer, Consumer } from 'mediasoup/node/lib/types';
import type { JwtPayload, SocketRole, SocketData } from '../types';

// ── Active room state (in-memory per process; Redis handles cross-node sync) ──
interface RoomState {
  router: Router;
  producers: Map<string, Producer>;   // producerId → Producer
  consumers: Map<string, Consumer>;   // consumerId → Consumer
  transports: Map<string, WebRtcTransport>; // transportId → Transport
}

const rooms = new Map<string, RoomState>();

async function getOrCreateRoom(sessionId: string): Promise<RoomState> {
  if (rooms.has(sessionId)) return rooms.get(sessionId)!;
  const router = await createRouter();
  const room: RoomState = {
    router,
    producers: new Map(),
    consumers: new Map(),
    transports: new Map(),
  };
  rooms.set(sessionId, room);
  return room;
}

async function teardownRoom(sessionId: string, reason: string): Promise<void> {
  const room = rooms.get(sessionId);

  if (room) {
    for (const producer of room.producers.values()) producer.close();
    for (const consumer of room.consumers.values()) consumer.close();
    for (const transport of room.transports.values()) transport.close();
    room.producers.clear();
    room.consumers.clear();
    room.transports.clear();
    rooms.delete(sessionId);
  }

  await killRecording(sessionId);
  await query(
    `UPDATE participants SET left_at = NOW()
     WHERE session_id = $1 AND left_at IS NULL`,
    [sessionId],
  );
  await query(
    `UPDATE sessions SET status = 'ENDED', end_time = COALESCE(end_time, NOW())
     WHERE id = $1 AND status <> 'ENDED'`,
    [sessionId],
  );

  if (io) {
    io.to(sessionId).emit('room:closed');
    const sockets = await io.in(sessionId).fetchSockets();
    sockets.forEach((s) => {
      s.emit('participant:left', {
        displayName: (s.data as SocketData).displayName,
        role: (s.data as SocketData).role,
      });
      s.disconnect(true);
    });
  }

  console.warn(`[Socket] Torn down room ${sessionId}: ${reason}`);
}

// ── Typed Socket.io event interfaces ──────────────────────────────────────────
interface ServerToClientEvents {
  // Room lifecycle
  'room:closed': () => void;
  'participant:joined': (data: { displayName: string; role: SocketRole; socketId: string }) => void;
  'participant:left': (data: { displayName: string; role: SocketRole; socketId: string }) => void;

  // Admin controls
  'room:force_mute': () => void;
  'room:kicked': () => void;

  // Mediasoup signaling
  'router:capabilities': (data: { rtpCapabilities: unknown }) => void;
  'transport:created': (data: {
    id: string;
    iceParameters: unknown;
    iceCandidates: unknown;
    dtlsParameters: unknown;
  }) => void;
  'newProducer': (data: { producerId: string; socketId: string; kind: string }) => void;

  // Chat
  'chat:receive': (msg: {
    id: string;
    senderName: string;
    payload: string;
    isFile: boolean;
    timestamp: string;
  }) => void;

  // Errors
  'heartbeat:ping': () => void;
  'recording:status': (data: { active: boolean; message: string }) => void;
  error: (data: { message: string }) => void;
}

interface ClientToServerEvents {
  // Room lifecycle
  'room:join': (data: { sessionId: string; displayName?: string }) => void;

  // Mediasoup signaling
  'transport:create': (data: { direction: 'send' | 'recv' }, cb: (params: unknown) => void) => void;
  'transport:connect': (data: { transportId: string; dtlsParameters: unknown }, cb: () => void) => void;
  'transport:restartIce': (data: { transportId: string }, cb: (params: unknown) => void) => void;
  'produce': (data: {
    transportId: string;
    kind: string;
    rtpParameters: unknown;
    appData?: unknown;
  }, cb: (producerId: string) => void) => void;
  'consume': (data: {
    transportId: string;
    producerId: string;
    rtpCapabilities: unknown;
  }, cb: (params: unknown) => void) => void;
  'consumer:resume': (data: { consumerId: string }, cb?: () => void) => void;
  'heartbeat:pong': () => void;
  'agent:start_recording': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:stop_recording': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:end_session': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:mute_all': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:remove_participant': (data: { socketId: string }, cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'telemetry:media': (data: { rtt: number; jitter: number; packetLossFraction: number; timestamp: number }) => void;

  // Chat
  'chat:send': (data: { payload: string; isFile?: boolean }) => void;
}

type AtomSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// ── Exported io instance ──────────────────────────────────────────────────────
let io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

async function ensureRedis(): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
}

async function updateActiveParticipant(sessionId: string, socket: AtomSocket): Promise<void> {
  await ensureRedis();
  const key = `active:socket:${socket.id}`;
  await redis
    .multi()
    .sadd('active:sessions', sessionId)
    .sadd(`active:session:${sessionId}:participants`, key)
    .hset(key, {
      socketId: socket.id,
      userId: socket.data.userId,
      displayName: socket.data.displayName,
      role: socket.data.role,
      sessionId,
      joinedAt: new Date().toISOString(),
    })
    .expire(key, 60 * 60 * 12)
    .exec();
}

async function removeActiveParticipant(sessionId: string, socketId: string): Promise<void> {
  await ensureRedis();
  const key = `active:socket:${socketId}`;
  await redis
    .multi()
    .srem(`active:session:${sessionId}:participants`, key)
    .del(key)
    .exec();
  if ((await redis.scard(`active:session:${sessionId}:participants`)) === 0) {
    await redis.srem('active:sessions', sessionId);
  }
}

export function initSocket(httpServer: HttpServer): typeof io {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  // ── Redis adapter (solves split-brain on horizontal scale) ─────────────────
  // Uses two separate Redis connections as required by the adapter
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Socket] Redis adapter active');
  }).catch((err: Error) => {
    console.warn('[Socket] Redis unavailable — running single-node mode:', err.message);
  });

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket: AtomSocket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      const sessionId = socket.handshake.auth?.sessionId as string | undefined;

      if (token) {
        const secret = process.env.JWT_SECRET;
        if (!secret) return next(new Error('Server misconfiguration'));
        let payload: JwtPayload;
        try {
          payload = jwt.verify(token, secret) as JwtPayload;
        } catch {
          return next(new Error('Invalid or expired token'));
        }
        socket.data = {
          userId: payload.sub,
          displayName: payload.email,
          role: payload.role as SocketRole,
          sessionId: sessionId ?? '',
          transports: new Set<string>(),
        };
        return next();
      }

      if (sessionId) {
        const result = await query<{ id: string; status: string }>(
          `SELECT id, status FROM sessions WHERE id = $1`,
          [sessionId],
        );
        if (!result.rows[0]) return next(new Error('Session not found'));
        if (result.rows[0].status === 'ENDED') return next(new Error('Session has ended'));

        socket.data = {
          userId: `guest_${socket.id}`,
          displayName: (socket.handshake.auth?.displayName as string | undefined) ?? 'Customer',
          role: 'CUSTOMER',
          sessionId,
          transports: new Set<string>(),
        };
        return next();
      }

      return next(new Error('Authentication required'));
    } catch (err) {
      return next(new Error(`Auth error: ${(err as Error).message}`));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket: AtomSocket) => {
    const { userId, displayName, role, sessionId } = socket.data;
    console.log(`[Socket] Connected: ${displayName} (${role}) → session ${sessionId}`);

    // ── RBAC guard ────────────────────────────────────────────────────────
    let missedPongs = 0;
    const heartbeatInterval = setInterval(() => {
      missedPongs += 1;
      if (missedPongs >= 3) {
        clearInterval(heartbeatInterval);
        void teardownRoom(sessionId, `heartbeat timeout for ${displayName}`);
        return;
      }
      socket.emit('heartbeat:ping');
    }, 20_000);

    socket.on('heartbeat:pong', () => {
      missedPongs = 0;
    });

    function guardRole(allowedRoles: SocketRole[]): boolean {
      if (!allowedRoles.includes(role)) {
        socket.emit('error', { message: 'Insufficient permissions' });
        console.warn(`[Socket] RBAC violation by ${displayName} (${role})`);
        void logSecurityEvent('socket_rbac_violation', 'Socket event rejected by role guard', {
          socketId: socket.id,
          sessionId,
          userId,
          displayName,
          role,
          allowedRoles,
        });
        return false;
      }
      return true;
    }

    // ── room:join ─────────────────────────────────────────────────────────
    socket.on('room:join', async (data) => {
      const roomId = data.sessionId ?? sessionId;
      const lockKey = `lock:room:${roomId}:user:${userId}`;
      let lockAcquired = false;
      try {
        await ensureRedis();
        lockAcquired = (await redis.set(lockKey, socket.id, 'PX', 5000, 'NX')) === 'OK';
        if (!lockAcquired) {
          socket.emit('error', { message: 'Join already in progress for this participant' });
          return;
        }

        // Evict duplicate connection for same user
        const existingSockets = await io.in(roomId).fetchSockets();
        for (const s of existingSockets) {
          if ((s.data as SocketData).userId === userId && s.id !== socket.id) {
            s.disconnect(true);
            console.log(`[Socket] Evicted duplicate for user ${userId}`);
          }
        }

        await socket.join(roomId);
        await updateActiveParticipant(roomId, socket);

        // Let the joining client know about agents already present in the room.
        for (const s of existingSockets) {
          const participant = s.data as SocketData;
          if ((participant.role === 'AGENT' || participant.role === 'ADMIN') && s.id !== socket.id) {
            socket.emit('participant:joined', {
              displayName: participant.displayName,
              role: participant.role,
              socketId: s.id,
            });
          }
        }

        // Ensure Mediasoup room exists
        const room = await getOrCreateRoom(roomId);

        // Send router RTP capabilities so client can set up its Device
        socket.emit('router:capabilities', {
          rtpCapabilities: room.router.rtpCapabilities,
        });

        // Notify others this participant joined
        socket.to(roomId).emit('participant:joined', {
          displayName,
          role,
          socketId: socket.id,
        });

        // Persist participant entry
        const dbRole = role === 'ADMIN' ? 'AGENT' : role;
        await query(
          `INSERT INTO participants (session_id, display_name, role)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [roomId, displayName, dbRole],
        );

        // Activate session when agent joins
        if (role === 'AGENT' || role === 'ADMIN') {
          await query(
            `UPDATE sessions SET status = 'ACTIVE', start_time = NOW()
             WHERE id = $1 AND status = 'WAITING'`,
            [roomId],
          );
        }

        // Tell joining client about all existing producers in the room
        const { producers } = room;
        for (const [producerId, producer] of producers) {
          // Do not send the user their own producers (prevents mirror tiles on reconnect/duplicate tabs)
          if (producer.appData.userId === userId) continue;

          const source = producer.appData.source as string | undefined;
          const kind = source === 'screen' ? 'screen' : producer.kind;
          socket.emit('newProducer', {
            producerId,
            socketId: (producer.appData.socketId as string) || '',
            kind,
          });
        }

        console.log(`[Socket] ${displayName} joined room ${roomId}`);
      } catch (err) {
        socket.emit('error', { message: 'Failed to join room' });
        console.error('[Socket] room:join error:', (err as Error).message);
      } finally {
        if (lockAcquired) await redis.del(lockKey).catch(() => undefined);
      }
    });

    // ── transport:create ──────────────────────────────────────────────────
    // Client requests a WebRtcTransport (one for send, one for recv)
    socket.on('transport:create', async (data, cb) => {
      const room = rooms.get(sessionId);
      if (!room) { cb({ error: 'Room not found' }); return; }

      const listenIp = process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0';
      const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1';

      try {
        const transport = await room.router.createWebRtcTransport({
          listenInfos: [
            {
              protocol: 'udp',
              ip: listenIp,
              announcedAddress: announcedIp,
            },
            {
              protocol: 'tcp',
              ip: listenIp,
              announcedAddress: announcedIp,
            },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        room.transports.set(transport.id, transport);
        socket.data.transports.add(transport.id);

        console.log(`[Socket] Created ${data.direction} transport ${transport.id} for ${displayName}`);

        cb({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.error('[Socket] transport:create error:', (err as Error).message);
        cb({ error: (err as Error).message });
      }
    });

    // ── transport:connect ─────────────────────────────────────────────────
    // Client provides DTLS parameters to establish the secure UDP tunnel
    socket.on('transport:connect', async (data, cb) => {
      const room = rooms.get(sessionId);
      if (!room) { cb(); return; }
      const transport = room.transports.get(data.transportId);
      if (!transport) { cb(); return; }

      try {
        await transport.connect({ dtlsParameters: data.dtlsParameters as Parameters<typeof transport.connect>[0]['dtlsParameters'] });
        cb();
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
        cb();
      }
    });

    // ── produce ───────────────────────────────────────────────────────────
    // Client announces a new media track (audio or video)
    socket.on('transport:restartIce', async (data, cb) => {
      const room = rooms.get(sessionId);
      const transport = room?.transports.get(data.transportId);
      if (!transport) { cb({ error: 'Transport not found' }); return; }

      try {
        const iceParameters = await transport.restartIce();
        cb({ iceParameters });
      } catch (err) {
        cb({ error: (err as Error).message });
      }
    });

    socket.on('produce', async (data, cb) => {
      const room = rooms.get(sessionId);
      if (!room) { cb(''); return; }
      const transport = room.transports.get(data.transportId);
      if (!transport) { cb(''); return; }

      try {
        const producer = await transport.produce({
          kind: data.kind as 'audio' | 'video',
          rtpParameters: data.rtpParameters as Parameters<typeof transport.produce>[0]['rtpParameters'],
          appData: { ...(data.appData || {}), socketId: socket.id, userId: socket.data.userId } as Record<string, unknown>,
        });

        room.producers.set(producer.id, producer);
        if (isRecording(sessionId)) {
          await recordProducer(sessionId, room.router, producer);
        }

        // Notify all other participants in the room about this new producer
        // Use 'screen' as the kind when the producer's appData indicates it's a screen share
        const source = (data.appData as Record<string, unknown> | undefined)?.source as string | undefined;
        const emittedKind = source === 'screen' ? 'screen' : producer.kind;
        socket.to(sessionId).emit('newProducer', {
          producerId: producer.id,
          socketId: socket.id,
          kind: emittedKind,
        });

        producer.on('transportclose', () => {
          room.producers.delete(producer.id);
        });

        cb(producer.id);
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
        cb('');
      }
    });

    // ── consume ───────────────────────────────────────────────────────────
    // Client requests to receive a specific producer's stream
    socket.on('consume', async (data, cb) => {
      const room = rooms.get(sessionId);
      if (!room) { cb({ error: 'Room not found' }); return; }

      const transport = room.transports.get(data.transportId);
      if (!transport) { cb({ error: 'Transport not found' }); return; }

      const producer = room.producers.get(data.producerId);
      if (!producer) { cb({ error: 'Producer not found' }); return; }

      if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities: data.rtpCapabilities as Parameters<typeof room.router.canConsume>[0]['rtpCapabilities'] })) {
        cb({ error: 'Cannot consume — incompatible RTP capabilities' });
        return;
      }

      try {
        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: data.rtpCapabilities as Parameters<typeof transport.consume>[0]['rtpCapabilities'],
          paused: true, // client resumes after setting up the track
        });

        room.consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => room.consumers.delete(consumer.id));
        consumer.on('producerclose', () => {
          room.consumers.delete(consumer.id);
          // Include the producer owner's socketId and source so the client can remove the right tile
          const ownerSocketId = (producer.appData.socketId as string) || '';
          const source = (producer.appData.source as string) || '';
          const closedKind = source === 'screen' ? 'screen-closed' : 'closed';
          socket.emit('newProducer', { producerId: data.producerId, socketId: ownerSocketId, kind: closedKind });
        });

        cb({
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        cb({ error: (err as Error).message });
      }
    });

    // ── chat:send ─────────────────────────────────────────────────────────
    socket.on('consumer:resume', async (data, cb) => {
      const room = rooms.get(sessionId);
      const consumer = room?.consumers.get(data.consumerId);

      try {
        await consumer?.resume();
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      } finally {
        cb?.();
      }
    });

    socket.on('chat:send', async (data) => {
      const payload = data.payload?.trim();
      const isFile = data.isFile === true;
      if (!payload) { socket.emit('error', { message: 'Empty message' }); return; }

      try {
        const result = await query<{ id: string; payload: string; is_file: boolean; timestamp: Date }>(
          `INSERT INTO chat_messages (session_id, sender_name, payload, is_file)
           VALUES ($1, $2, $3, $4) RETURNING id, payload, is_file, timestamp`,
          [sessionId, displayName, payload, isFile],
        );
        const { id, timestamp, payload: persistedPayload, is_file: persistedIsFile } = result.rows[0];
        io.to(sessionId).emit('chat:receive', {
          id,
          senderName: displayName,
          payload: persistedPayload,
          isFile: persistedIsFile,
          timestamp: timestamp.toISOString(),
        });
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
        console.error('[Socket] chat:send error:', (err as Error).message);
      }
    });

    socket.on('telemetry:media', (data) => {
      recordMediaSample({
        sessionId,
        socketId: socket.id,
        role,
        rtt: Number.isFinite(data.rtt) ? data.rtt : 0,
        jitter: Number.isFinite(data.jitter) ? data.jitter : 0,
        packetLossFraction: Number.isFinite(data.packetLossFraction) ? data.packetLossFraction : 0,
        timestamp: data.timestamp,
      });
    });

    // ── disconnect / cleanup ──────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      clearInterval(heartbeatInterval);
      console.log(`[Socket] Disconnected: ${displayName} — ${reason}`);
      try {
        await query(
          `UPDATE participants SET left_at = NOW()
           WHERE session_id = $1 AND display_name = $2 AND left_at IS NULL`,
          [sessionId, displayName],
        );
        socket.to(sessionId).emit('participant:left', { displayName, role, socketId: socket.id });
        await removeActiveParticipant(sessionId, socket.id);

        // Clean up Mediasoup transports owned by this socket
        const room = rooms.get(sessionId);
        if (room && socket.data.transports) {
          for (const transportId of socket.data.transports) {
            const transport = room.transports.get(transportId);
            if (transport) {
              transport.close(); // Also triggers close for associated producers/consumers
              room.transports.delete(transportId);
            }
          }
        }
      } catch (err) {
        console.error('[Socket] Disconnect cleanup error:', (err as Error).message);
      }
    });

    // ── Block privileged events from customers ────────────────────────────
    socket.on('agent:start_recording', async (cb) => {
      if (!guardRole(['AGENT', 'ADMIN'])) {
        cb?.({ ok: false, error: 'Insufficient permissions' });
        return;
      }

      const room = rooms.get(sessionId);
      if (!room) {
        cb?.({ ok: false, error: 'Room not found' });
        return;
      }

      try {
        await startRecording(sessionId, room.router, room.producers.values());
        io.to(sessionId).emit('recording:status', { active: true, message: 'Recording started' });
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('agent:stop_recording', async (cb) => {
      if (!guardRole(['AGENT', 'ADMIN'])) {
        cb?.({ ok: false, error: 'Insufficient permissions' });
        return;
      }

      try {
        await stopRecording(sessionId, true);
        io.to(sessionId).emit('recording:status', { active: false, message: 'Recording processing' });
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('agent:end_session', async (cb) => {
      if (!guardRole(['AGENT', 'ADMIN'])) {
        cb?.({ ok: false, error: 'Insufficient permissions' });
        return;
      }

      try {
        await teardownRoom(sessionId, 'Admin ended session');
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('agent:mute_all', async (cb) => {
      if (!guardRole(['AGENT', 'ADMIN'])) {
        cb?.({ ok: false, error: 'Insufficient permissions' });
        return;
      }

      try {
        // Force everyone except the sender to mute
        socket.to(sessionId).emit('room:force_mute');
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on('agent:remove_participant', async (data, cb) => {
      if (!guardRole(['AGENT', 'ADMIN'])) {
        cb?.({ ok: false, error: 'Insufficient permissions' });
        return;
      }

      try {
        const targetSocket = io.sockets.sockets.get(data.socketId);
        if (targetSocket) {
          targetSocket.emit('room:kicked');
          // Disconnect them gracefully after 100ms
          setTimeout(() => targetSocket.disconnect(true), 100);
        }
        cb?.({ ok: true });
      } catch (err) {
        cb?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.onAny((event: string) => {
      const agentOnly = ['agent:end_session', 'agent:start_recording', 'agent:stop_recording', 'agent:mute_all', 'agent:remove_participant'];
      if (agentOnly.includes(event)) guardRole(['AGENT', 'ADMIN']);
    });
  });

  return io;
}

export { io, rooms };
