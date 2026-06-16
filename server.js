// ================================================================
// ROADS & CITIES — Multiplayer Server
// Node + Express + Socket.io
// 
// Funzionalità:
//   - Matchmaking automatico (coda "trova avversario")
//   - Stanze private con codice 6 cifre
//   - Stato partita server-side (anti-bari basico)
//   - Reconnect: se un giocatore disconnette, l'altro aspetta 60s
//
// Protocollo eventi client → server:
//   'mm:join'          — entra in coda matchmaking { name, avatar }
//   'mm:leave'         — esci dalla coda
//   'room:create'      — crea stanza privata { name, avatar }
//   'room:join'        — unisciti a stanza { code, name, avatar }
//   'game:move'        — invia mossa { col, row, rot, deckIdx }
//   'game:undo'        — richiesta undo
//   'game:resign'      — abbandono partita
//
// Eventi server → client:
//   'mm:waiting'       — sei in coda, in attesa
//   'room:created'     — { code, you } — stanza creata
//   'room:waiting'     — in attesa che entri il secondo
//   'room:error'       — { reason } — stanza non trovata o piena
//   'game:start'       — { you, opponent, round, totalRounds } — partita inizia
//   'game:state'       — { board, roadMap, currentPlayer, turn } — sync stato
//   'game:move'        — { col, row, rot, deckIdx, player } — mossa avversario
//   'game:end'         — { winner, score } — fine partita
//   'game:opp_left'    — avversario disconnesso
//   'game:opp_back'    — avversario riconnesso
// ================================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const PORT = process.env.PORT || 3000;
const RECONNECT_TIMEOUT_MS = 60_000;

// ── Setup HTTP ─────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.get('/', (req, res) => res.send('Roads & Cities multiplayer server is running'));
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Stato globale ──────────────────────────────────────────────
const matchmakingQueue = [];                   // [{ socketId, name, avatar }]
const rooms = new Map();                       // code → room
const playerRoom = new Map();                  // socketId → code
const disconnectTimers = new Map();            // socketId → setTimeout

function genRoomCode() {
  // 6 cifre, evita codici già in uso
  for (let i = 0; i < 10; i++) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom(code, isPrivate = false) {
  const room = {
    code,
    isPrivate,
    players: [],          // [{ socketId, name, avatar, slot: 0|1 }]
    state: {
      moves: [],          // storia mosse [{ player, col, row, rot, deckIdx, ts }]
      currentPlayer: 0,   // 0 o 1
      round: 1,
      totalRounds: 1,
      started: false,
      ended: false,
    },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function startGame(room) {
  room.state.started = true;
  room.state.currentPlayer = 0;

  // Invia game:start a entrambi con info reciproca
  const [p0, p1] = room.players;
  io.to(p0.socketId).emit('game:start', {
    you:      { slot: 0, name: p0.name, avatar: p0.avatar },
    opponent: { slot: 1, name: p1.name, avatar: p1.avatar },
    room: room.code,
    round: room.state.round,
    totalRounds: room.state.totalRounds,
  });
  io.to(p1.socketId).emit('game:start', {
    you:      { slot: 1, name: p1.name, avatar: p1.avatar },
    opponent: { slot: 0, name: p0.name, avatar: p0.avatar },
    room: room.code,
    round: room.state.round,
    totalRounds: room.state.totalRounds,
  });
  console.log(`[ROOM ${room.code}] Started: ${p0.name} vs ${p1.name}`);
}

function leaveAll(socketId) {
  // Rimuove dalla coda matchmaking
  const qIdx = matchmakingQueue.findIndex(p => p.socketId === socketId);
  if (qIdx >= 0) matchmakingQueue.splice(qIdx, 1);

  // Lascia stanza se ne ha una
  const code = playerRoom.get(socketId);
  if (code) {
    const room = rooms.get(code);
    if (room) {
      const opponentIdx = room.players.findIndex(p => p.socketId !== socketId);
      const opponent = opponentIdx >= 0 ? room.players[opponentIdx] : null;
      // Notifica avversario
      if (opponent) {
        io.to(opponent.socketId).emit('game:opp_left', { reconnectTimeoutMs: RECONNECT_TIMEOUT_MS });
      }
      // Timer di riconnessione: se non torna in 60s, distrugge la stanza
      const timer = setTimeout(() => {
        if (rooms.has(code)) {
          const r = rooms.get(code);
          if (r) {
            r.players.forEach(p => playerRoom.delete(p.socketId));
            rooms.delete(code);
            if (opponent) io.to(opponent.socketId).emit('game:end', {
              reason: 'opponent_abandoned',
              winner: opponentIdx,
            });
          }
        }
        disconnectTimers.delete(socketId);
      }, RECONNECT_TIMEOUT_MS);
      disconnectTimers.set(socketId, timer);
    }
  }
}

// ── Socket events ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── MATCHMAKING ──
  socket.on('mm:join', ({ name, avatar }) => {
    name = (name || 'Giocatore').slice(0, 20);
    avatar = avatar || 'preset:0';

    // Già in coda? ignora
    if (matchmakingQueue.find(p => p.socketId === socket.id)) return;

    matchmakingQueue.push({ socketId: socket.id, name, avatar });
    socket.emit('mm:waiting', { queueLength: matchmakingQueue.length });

    // Se ci sono almeno 2 giocatori in coda → match!
    if (matchmakingQueue.length >= 2) {
      const p0 = matchmakingQueue.shift();
      const p1 = matchmakingQueue.shift();
      const code = genRoomCode();
      const room = createRoom(code, false);
      room.players = [
        { ...p0, slot: 0 },
        { ...p1, slot: 1 },
      ];
      playerRoom.set(p0.socketId, code);
      playerRoom.set(p1.socketId, code);
      io.sockets.sockets.get(p0.socketId)?.join(code);
      io.sockets.sockets.get(p1.socketId)?.join(code);
      startGame(room);
    }
  });

  socket.on('mm:leave', () => {
    const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (idx >= 0) matchmakingQueue.splice(idx, 1);
  });

  // ── STANZE PRIVATE ──
  socket.on('room:create', ({ name, avatar }) => {
    name = (name || 'Giocatore').slice(0, 20);
    avatar = avatar || 'preset:0';
    const code = genRoomCode();
    const room = createRoom(code, true);
    room.players.push({ socketId: socket.id, name, avatar, slot: 0 });
    playerRoom.set(socket.id, code);
    socket.join(code);
    socket.emit('room:created', { code });
    socket.emit('room:waiting', { code });
    console.log(`[ROOM ${code}] Created by ${name}`);
  });

  socket.on('room:join', ({ code, name, avatar }) => {
    code = (code || '').trim();
    name = (name || 'Giocatore').slice(0, 20);
    avatar = avatar || 'preset:0';

    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { reason: 'not_found' });
    if (room.players.length >= 2) return socket.emit('room:error', { reason: 'full' });
    if (room.state.started) return socket.emit('room:error', { reason: 'already_started' });

    room.players.push({ socketId: socket.id, name, avatar, slot: 1 });
    playerRoom.set(socket.id, code);
    socket.join(code);
    startGame(room);
  });

  // ── GIOCO ──
  socket.on('game:move', (data) => {
    const code = playerRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || !room.state.started || room.state.ended) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // Validazione: è il turno di questo giocatore?
    if (player.slot !== room.state.currentPlayer) {
      socket.emit('game:error', { reason: 'not_your_turn' });
      return;
    }

    // Registra mossa
    const move = {
      player: player.slot,
      col: data.col,
      row: data.row,
      rot: data.rot,
      deckIdx: data.deckIdx,
      ts: Date.now(),
    };
    room.state.moves.push(move);
    room.state.currentPlayer = 1 - room.state.currentPlayer;

    // Broadcast all'avversario
    socket.to(code).emit('game:move', move);
  });

  socket.on('game:skip', () => {
    const code = playerRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || !room.state.started) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (player.slot !== room.state.currentPlayer) return;

    room.state.currentPlayer = 1 - room.state.currentPlayer;
    socket.to(code).emit('game:skip', { player: player.slot });
  });

  socket.on('game:round_end', ({ score, penalties }) => {
    // Inoltra all'avversario il punteggio del proprio round
    const code = playerRoom.get(socket.id);
    if (!code) return;
    const player = rooms.get(code)?.players.find(p => p.socketId === socket.id);
    if (!player) return;
    socket.to(code).emit('game:round_end', { player: player.slot, score, penalties });
  });

  socket.on('game:resign', () => {
    const code = playerRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.state.ended = true;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    io.to(code).emit('game:end', {
      reason: 'resigned',
      winner: 1 - player.slot,
    });
  });

  // ── DISCONNECT / RECONNECT ──
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    leaveAll(socket.id);
  });
});

// ── Cleanup periodico stanze stale ─────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Stanza creata da >30min e non iniziata → distruggi
    if (!room.state.started && (now - room.createdAt) > 30 * 60 * 1000) {
      room.players.forEach(p => playerRoom.delete(p.socketId));
      rooms.delete(code);
      console.log(`[CLEANUP] Removed stale room ${code}`);
    }
  }
}, 5 * 60 * 1000);

// ── Keepalive: impedisce il cold start su Render free plan ────
// Render mette in sleep dopo 15min di inattività.
// Un self-ping ogni 14min mantiene il server sveglio.
// Solo in produzione (RENDER_EXTERNAL_URL è settato da Render automaticamente).
if (process.env.RENDER_EXTERNAL_URL) {
  const KEEPALIVE_URL = process.env.RENDER_EXTERNAL_URL + '/health';
  setInterval(async () => {
    try {
      const res = await fetch(KEEPALIVE_URL);
      console.log(`[KEEPALIVE] ${res.status} ${new Date().toISOString()}`);
    } catch (e) {
      console.warn('[KEEPALIVE] failed:', e.message);
    }
  }, 14 * 60 * 1000); // 14 minuti
  console.log(`[KEEPALIVE] Attivo → ${KEEPALIVE_URL}`);
}

// ── Avvio ──────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Roads & Cities multiplayer server on port ${PORT}`);
});
