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
import { createRequire } from 'module';

// rules-shared.js e deck.js sono SCRITTI per girare ovunque (browser incluso),
// quindi usano module.exports in stile CommonJS. Questo file (server.js) è
// ESM puro (il progetto ha "type":"module" in package.json) — createRequire
// permette di caricare moduli CommonJS da dentro un file ESM senza dover
// riscrivere tutto il server in CommonJS solo per due import.
// I file vivono in shared/ con un package.json locale {"type":"commonjs"}
// che forza Node a interpretarli come CommonJS lì dentro, a prescindere dal
// package.json principale. Sono COPIE IDENTICHE degli stessi file usati dal
// client (js/rules-shared.js, js/deck.js) — se modifichi le regole di gioco
// o il deck, aggiorna ENTRAMBE le copie (client e shared/), altrimenti client
// e server finiscono per validare con regole diverse.
const require = createRequire(import.meta.url);
const Rules = require('./shared/rules-shared.js');
const DECK = require('./shared/deck.js');

const PORT = process.env.PORT || 3000;
const RECONNECT_TIMEOUT_MS = 60_000;

// Origine consentita: SOLO il dominio reale del gioco. Prima era '*' (chiunque,
// da qualsiasi sito, poteva collegarsi al server e usarne le risorse gratis
// del piano Render, incluso l'endpoint /track). Costo zero chiuderlo.
const ALLOWED_ORIGIN = 'https://roads-and-cities.support-roadsandcities.workers.dev';

// ── Setup HTTP ─────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '512kb', type: ['application/json', 'text/plain'] }));
app.get('/', (req, res) => res.send('Roads & Cities multiplayer server is running'));
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// ── ANALYTICS (beta) ───────────────────────────────────────────
// Buffer in memoria: gli eventi arrivano dal client e vengono stampati
// nei log di Render (visibili dalla dashboard Render → Logs).
// GET /track/recent → vedi gli ultimi 200 eventi nel browser.
const analyticsBuf = [];
const ANALYTICS_MAX = 500;
app.post('/track', (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const v = req.body?.v || '?';
  for (const e of events) {
    const rec = { ...e, v, recv: Date.now() };
    analyticsBuf.push(rec);
    console.log('[ANALYTICS]', JSON.stringify(rec));
  }
  if (analyticsBuf.length > ANALYTICS_MAX) analyticsBuf.splice(0, analyticsBuf.length - ANALYTICS_MAX);
  res.json({ ok: true, n: events.length });
});
app.get('/track/recent', (req, res) => res.json(analyticsBuf.slice(-200)));

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
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
      // ── Validazione mosse (v2) ──
      // Stato di gioco vero (board/roadMap), ricostruito mossa dopo mossa
      // via Rules.applyMoveToState. Permette al server di verificare se una
      // mossa è LEGALE prima di accettarla — non solo se è il turno giusto.
      // Default 10x10 senza entry points; sovrascritto in startGame() se il
      // client che avvia la partita ha inviato mapData.
      game: Rules.createEmptyState(10, 10, []),
      // Contatore skip CONSECUTIVI (azzerato da ogni mossa valida). Se
      // arriva a 2, significa che entrambi i giocatori hanno saltato di
      // fila senza che nessuno piazzasse nel mezzo — nessuno dei due può
      // più giocare, quindi è game over per stallo. Prima questo controllo
      // esisteva SOLO lato client (placement.js → checkAutoSkip), che però
      // online non viene mai eseguito: senza questo contatore, i due client
      // si scambiano skip confermati dal server all'infinito, senza che la
      // partita finisca mai.
      consecutiveSkips: 0,
    },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function startGame(room) {
  room.state.started = true;
  room.state.currentPlayer = 0;

  // ── Costruisce lo stato di gioco reale (board/roadMap/entryPoints) ──
  // Se è una stanza privata con una mappa custom in attesa (pendingMapData,
  // salvata da room:create), applica i suoi entry points. Altrimenti resta
  // la mappa standard 10x10 già creata in createRoom().
  if (room.pendingMapData && Array.isArray(room.pendingMapData.entryPoints)) {
    Rules.applyMapEntryPoints(room.state.game, room.pendingMapData.entryPoints);
  }

  // Invia game:start a entrambi con info reciproca, INCLUSA la mappa che il
  // server ha effettivamente applicato (null per il matchmaking standard).
  // Il client deve visualizzare ESATTAMENTE questa mappa, non una "attiva"
  // letta da localStorage — altrimenti i due lati possono divergere.
  const [p0, p1] = room.players;
  io.to(p0.socketId).emit('game:start', {
    you:      { slot: 0, name: p0.name, avatar: p0.avatar },
    opponent: { slot: 1, name: p1.name, avatar: p1.avatar },
    room: room.code,
    round: room.state.round,
    totalRounds: room.state.totalRounds,
    mapData: room.pendingMapData || null,
  });
  io.to(p1.socketId).emit('game:start', {
    you:      { slot: 1, name: p1.name, avatar: p1.avatar },
    opponent: { slot: 0, name: p0.name, avatar: p0.avatar },
    room: room.code,
    round: room.state.round,
    totalRounds: room.state.totalRounds,
    mapData: room.pendingMapData || null,
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
  // Solo le stanze private possono avere una mappa custom (entry points).
  // Il matchmaking automatico resta sempre sulla mappa standard 10x10:
  // due sconosciuti abbinati a caso non devono ritrovarsi a giocare una
  // mappa che uno dei due ha scelto senza che l'altro lo sapesse.
  socket.on('room:create', ({ name, avatar, mapData }) => {
    name = (name || 'Giocatore').slice(0, 20);
    avatar = avatar || 'preset:0';
    const code = genRoomCode();
    const room = createRoom(code, true);
    room.pendingMapData = (mapData && typeof mapData === 'object') ? mapData : null;
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

    // Validazione 1: è il turno di questo giocatore?
    if (player.slot !== room.state.currentPlayer) {
      socket.emit('game:error', { reason: 'not_your_turn' });
      return;
    }

    // Validazione 2: i dati della mossa hanno una forma sensata?
    // (prima di qualunque lookup, per evitare crash su input malformato)
    const { col, row, rot, deckIdx } = data || {};
    if (
      !Number.isInteger(col) || !Number.isInteger(row) ||
      !Number.isInteger(rot) || rot < 0 || rot > 3 ||
      !Number.isInteger(deckIdx) || deckIdx < 0 || deckIdx >= DECK.length
    ) {
      socket.emit('game:error', { reason: 'invalid_move', detail: 'malformed' });
      return;
    }
    const piece = DECK[deckIdx];

    // Validazione 3 — QUESTA è la validazione vera: la mossa è LEGALE secondo
    // le regole di piazzamento (celle libere, bordo/entry point alla prima
    // mossa, coerenza stradale, connessione alla propria rete)? Prima questo
    // controllo non esisteva: il server fidava ciecamente del client.
    room.state.game.currentPlayer = player.slot;
    const result = Rules.checkPlacementRules({
      piece, rot, originCol: col, originRow: row, state: room.state.game,
    });
    if (!result.ok) {
      socket.emit('game:error', { reason: 'invalid_move', detail: result.reason });
      console.warn(`[ROOM ${code}] Mossa rifiutata da ${player.name}: ${result.reason}`);
      return;
    }

    // Mossa valida: applica allo stato di gioco reale del server...
    Rules.applyMoveToState(room.state.game, { piece, rot, col, row, player: player.slot });

    // ...e registra mossa nello storico (per log/debug/futuro replay)
    const move = {
      player: player.slot,
      col, row, rot, deckIdx,
      ts: Date.now(),
    };
    room.state.moves.push(move);
    room.state.currentPlayer = 1 - room.state.currentPlayer;
    room.state.consecutiveSkips = 0;   // una mossa valida rompe la catena di skip

    // Conferma esplicita al MITTENTE: prima la mossa veniva broadcastata
    // solo all'avversario, e chi l'aveva inviata non aveva modo di sapere
    // con certezza se fosse stata accettata (solo l'assenza di un errore).
    // Il client ora aspetta questo evento prima di applicare la mossa in
    // locale — niente più piazzamento ottimistico che può desincronizzarsi.
    socket.emit('game:move_accepted', move);

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
    room.state.consecutiveSkips = (room.state.consecutiveSkips || 0) + 1;

    const skipData = { player: player.slot };
    socket.emit('game:skip_accepted', skipData);
    socket.to(code).emit('game:skip', skipData);

    // Due skip di fila, senza nessuna mossa valida nel mezzo, significa che
    // ENTRAMBI i giocatori sono bloccati — stesso identico criterio usato
    // offline in placement.js. Senza questo controllo, i due client si
    // scambiano skip confermati all'infinito e la partita non finisce mai.
    if (room.state.consecutiveSkips >= 2) {
      room.state.ended = true;
      io.to(code).emit('game:end', { reason: 'stalemate' });
      console.log(`[ROOM ${code}] Stallo: nessun giocatore può più piazzare — round terminato`);
    }
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
