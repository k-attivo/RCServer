# Roads & Cities — Multiplayer Server

Node.js + Express + Socket.io multiplayer server for **Roads & Cities** game.

## Features

- 🎮 **Automatic Matchmaking** — Queue-based player pairing
- 🔐 **Private Rooms** — 6-digit codes for custom games
- ⚔️ **Server-Side Game State** — Basic anti-cheat move validation
- 🔄 **Reconnection** — 60-second grace period for disconnected players
- 🧹 **Auto-Cleanup** — Removes stale rooms after 30 minutes

## Setup

```bash
npm install
npm start
```

Server runs on `PORT` (default: 3000)

## API Endpoints

- `GET /` — Health check
- `GET /health` — JSON status

## Socket.IO Events

### Matchmaking
- `mm:join` — Join matchmaking queue
- `mm:leave` — Leave queue
- `mm:waiting` — Currently waiting in queue

### Private Rooms
- `room:create` — Create a new room
- `room:join` — Join existing room by code
- `room:created` — Room created successfully
- `room:waiting` — Waiting for second player
- `room:error` — Room error (not found, full, already started)

### Gameplay
- `game:start` — Game started
- `game:move` — Send/receive player move
- `game:skip` — Skip turn
- `game:round_end` — End of round with scores
- `game:resign` — Player resignation
- `game:end` — Game ended

### Disconnection
- `game:opp_left` — Opponent disconnected
- `game:opp_back` — Opponent reconnected

## Requirements

- Node.js >= 18.0.0
- Express 4.19.2+
- Socket.io 4.7.5+
- CORS enabled

## Deployment

Deploy on Render, Railway, Heroku, or any Node.js hosting:

- **Build**: `npm install`
- **Start**: `npm start`
- **Runtime**: Node.js

## License

Beta 0.64+
