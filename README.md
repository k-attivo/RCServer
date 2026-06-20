# Roads & Cities — Multiplayer Server

Node.js + Express + Socket.io multiplayer server for **Roads & Cities** game.

## Features

- 🎮 **Automatic Matchmaking** — Queue-based player pairing
- 🔐 **Private Rooms** — 6-digit codes for custom games
- ⚔️ **Turn Validation** — Rejects moves sent out of turn (does NOT yet validate
  that a move is a legal placement under the game's rules — the client could
  still send any col/row/rot. Low priority with few beta testers; should be
  implemented before opening multiplayer to a wider audience)
- 🔄 **Reconnection** — 60-second grace period for disconnected players
- 🧹 **Auto-Cleanup** — Removes stale rooms after 30 minutes
- 📊 **Analytics endpoint** — `/track` buffers client-sent events in memory and logs them
- 🔒 **CORS restricted** — Only requests from the game's own domain
  (`roads-and-cities.support-roadsandcities.workers.dev`) are accepted, on
  both the HTTP routes and Socket.io. This also means `/track/recent` cannot
  be opened directly in a browser by typing the server URL — it must be
  fetched from a page already running on the allowed origin, or read from
  Render's own dashboard logs instead.

## Setup

```bash
npm install
npm start
```

Server runs on `PORT` (default: 3000)

## API Endpoints

- `GET /` — Health check
- `GET /health` — JSON status
- `POST /track` — Receives analytics events from the client (`{ v, events: [...] }`), buffers the last 500 in memory, also logged to console
- `GET /track/recent` — Returns the last 200 buffered analytics events as JSON (CORS-restricted — see below)

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
- CORS enabled (restricted to the game's domain)

## Repo files

- `server.js` — the server itself
- `package.json` — dependencies and start script
- `render.yaml` — Render Blueprint config (build/start commands, free plan, `NODE_ENV=production`)
- `.node-version` / `.nvmrc` — both pin Node to v20, so Render and any local
  dev environment use the same version. Keep both files in sync if this ever
  changes. (Note: `package.json`'s `engines.node` still says `>=18.0.0` —
  not wrong since 20 satisfies it, but worth tightening to `>=20.0.0` to
  match the pinned files exactly, if you want one source of truth.)

## Deployment

Already live on Render, connected to this GitHub repo (auto-deploys on push
to `main`). Configuration lives in `render.yaml` — free plan, builds with
`npm ci`, starts with `npm start`. No manual dashboard setup needed for new
deploys; just push to the connected branch.

## License

Beta 0.64+
