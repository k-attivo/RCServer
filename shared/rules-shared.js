// ================================================================
// RULES-SHARED — motore di regole puro, condiviso client/server
// ================================================================
// Nessuna dipendenza da Three.js, DOM, o window.RC globale: ogni funzione
// riceve lo stato di cui ha bisogno come parametro esplicito. Questo è
// IL FILE che decide se un piazzamento è legale — sia nel browser (per il
// feedback immediato al giocatore) sia sul server (per la validazione vera,
// quella che conta). Stessa logica, stesso file, zero rischio che le due
// implementazioni si disallineino nel tempo.
//
// Uso lato server (Node, CommonJS):
//   const Rules = require('./rules-shared.js');
//   Rules.checkPlacementRules({ piece, rot, originCol, originRow, state });
//
// Uso lato client (browser): il file si auto-registra su window.RC se
// `window` esiste, esponendo le stesse funzioni con la stessa firma. Il
// client le richiama passando lo "state" costruito dalle sue variabili
// globali (vedi l'adattatore in fondo al file).
//
// FORMATO STATE (identico per client e server):
//   {
//     board:        Array[BOARD_H][BOARD_W] di null | {player, deckIdx}
//     roadMap:      Array[BOARD_H][BOARD_W] di Set<'N'|'S'|'E'|'W'>
//     placedPieces: [{player, col, row, rot, deckIdx, rotCells}, ...]
//     currentPlayer: 0 | 1
//     boardW, boardH: numeri
//     entryPoints:  [{col, row, side}, ...]   — opzionale, [] se mappa standard
//     hasEntryPoints: boolean                  — opzionale, false se mappa standard
//   }
// ================================================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RC = root.RC || {};
    const exported = factory();
    // Nel browser, rotation.js (caricato PRIMA di questo file) già definisce
    // rotateCells/getPieceOff/applyRot/rotSide — stessa identica logica.
    // Non le sovrascriviamo: zero rischio di toccare codice che altri file
    // (es. map-editor.js) potrebbero usare in modi non verificati qui.
    // Esponiamo solo ciò che è genuinamente NUOVO: il motore di regole.
    root.RC.checkPlacementRulesShared        = exported.checkPlacementRules;
    root.RC.checkPlacementRulesStandard      = exported.checkPlacementRulesStandard;
    root.RC.checkPlacementRulesEntryPoints   = exported.checkPlacementRulesEntryPoints;
    root.RC.rulesApplyMoveToState            = exported.applyMoveToState;
    root.RC.rulesCreateEmptyState             = exported.createEmptyState;
    root.RC.rulesApplyMapEntryPoints          = exported.applyMapEntryPoints;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPPOSITE    = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const SIDE_DELTA  = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

  // ── ROTAZIONE (porting 1:1 di rotation.js — stessa logica) ───────────────
  function rotateCells(cells, rot) {
    return cells.map(([cx, cy]) => {
      let nx = cx, ny = cy;
      for (let i = 0; i < rot; i++) { [nx, ny] = [-ny, nx]; }
      return [nx, ny];
    });
  }

  function getPieceOff(pieceCells, rot) {
    const r = rotateCells(pieceCells, rot);
    return [
      Math.min(...r.map(c => c[0])),
      Math.min(...r.map(c => c[1])),
    ];
  }

  function applyRot(cells, rot, off) {
    return rotateCells(cells, rot).map(([x, y]) => [x - off[0], y - off[1]]);
  }

  function rotSide(side, rot) {
    const S = ['N', 'E', 'S', 'W'];
    return S[(S.indexOf(side) + rot) % 4];
  }

  function touchesBorder(c, r, boardW, boardH) {
    return c === 0 || c === boardW - 1 || r === 0 || r === boardH - 1;
  }

  // ── REGOLE STANDARD (porting 1:1 di placement.js → checkPlacementRules) ──
  // Stesso comportamento, stessi messaggi di errore in italiano (il client
  // li mostra all'utente; il server li usa solo per log/debug).
  function checkPlacementRulesStandard({ piece, rot, originCol, originRow, state }) {
    const { boardW, boardH, board, roadMap, placedPieces, currentPlayer } = state;
    const off = getPieceOff(piece.cells, rot);
    const rotCells = applyRot(piece.cells, rot, off);

    // 1. Celle libere e nel tabellone
    for (const [cx, cy] of rotCells) {
      const c = originCol + cx, r = originRow + cy;
      if (c < 0 || c >= boardW || r < 0 || r >= boardH) {
        return { ok: false, reason: 'Fuori dal tabellone' };
      }
      if (board[r][c] !== null) {
        return { ok: false, reason: 'Cella già occupata' };
      }
    }

    // PRIMA MOSSA del giocatore corrente → deve toccare il bordo
    const isFirstForPlayer =
      placedPieces.filter(p => p.player === currentPlayer).length === 0;
    if (isFirstForPlayer) {
      if (!rotCells.some(([cx, cy]) => touchesBorder(originCol + cx, originRow + cy, boardW, boardH))) {
        return { ok: false, reason: 'La tua prima mossa deve toccare il bordo' };
      }
    }

    const rotPorts = piece.roadPorts.map(p => ({
      side: rotSide(p.side, rot),
      cell: applyRot([p.cell], rot, off)[0],
    }));

    const pieceSet = new Set(rotCells.map(([cx, cy]) => `${originCol + cx},${originRow + cy}`));

    let connectsOwn = false;

    // 2. Una porta deve collegare a una strada del giocatore corrente
    for (const port of rotPorts) {
      const [cx, cy] = port.cell;
      const [dx, dz] = SIDE_DELTA[port.side];
      const nc = originCol + cx + dx, nr = originRow + cy + dz;
      if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
      if (pieceSet.has(`${nc},${nr}`)) continue;
      const cell = board[nr][nc];
      if (cell === null) continue;
      const neededSide = OPPOSITE[port.side];
      if (!roadMap[nr][nc].has(neededSide)) continue;
      if (cell.player === currentPlayer) connectsOwn = true;
    }

    // 3. Nessuna porta verso una cella occupata senza porta corrispondente
    for (const port of rotPorts) {
      const [cx, cy] = port.cell;
      const [dx, dz] = SIDE_DELTA[port.side];
      const nc = originCol + cx + dx, nr = originRow + cy + dz;
      if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
      if (pieceSet.has(`${nc},${nr}`)) continue;
      const cell = board[nr][nc];
      if (cell === null) continue;
      const neededSide = OPPOSITE[port.side];
      if (!roadMap[nr][nc].has(neededSide)) {
        return { ok: false, reason: 'Strada non compatibile con pezzo adiacente' };
      }
    }

    // 4. Controllo inverso: vicini con porta verso noi → noi dobbiamo avere porta
    for (const [cx, cy] of rotCells) {
      const cc = originCol + cx, cr = originRow + cy;
      for (const [side, [dx, dz]] of Object.entries(SIDE_DELTA)) {
        const nc = cc + dx, nr = cr + dz;
        if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
        if (pieceSet.has(`${nc},${nr}`)) continue;
        const cell = board[nr][nc];
        if (cell === null) continue;
        if (roadMap[nr][nc].has(OPPOSITE[side])) {
          const hasPort = rotPorts.some(p =>
            p.cell[0] === cx && p.cell[1] === cy && p.side === side);
          if (!hasPort) {
            return { ok: false, reason: 'Strada vicina richiede connessione' };
          }
        }
      }
    }

    // 5. Regola "deve collegarsi a una mia strada" — NON si applica alla prima mossa
    if (isFirstForPlayer) {
      return { ok: true, reason: '' };
    }

    if (!connectsOwn) {
      return { ok: false, reason: 'Devi collegarti a una tua strada piazzata' };
    }
    return { ok: true, reason: '' };
  }

  // ── REGOLE ENTRY POINTS (porting 1:1 di map-loader.js, righe ~1606-1772) ─
  // Sostituisce SOLO il controllo della prima mossa quando la mappa ha entry
  // points attivi; per il resto richiama le stesse verifiche di coerenza
  // stradale della versione standard.
  function checkPlacementRulesEntryPoints({ piece, rot, originCol, originRow, state }) {
    const { boardW, boardH, board, roadMap, placedPieces, currentPlayer, entryPoints } = state;

    const isFirstForPlayer =
      placedPieces.filter(p => p.player === currentPlayer).length === 0;
    if (!isFirstForPlayer) {
      return checkPlacementRulesStandard({ piece, rot, originCol, originRow, state });
    }

    const off = getPieceOff(piece.cells, rot);
    const rotCells = applyRot(piece.cells, rot, off);

    // Protezione: non bloccare tutti gli ingressi dell'avversario
    const needEntry = [0, 1].filter(p =>
      p !== currentPlayer &&
      placedPieces.filter(pp => pp.player === p).length === 0
    ).length;
    if (needEntry > 0) {
      const alreadyTaken = entryPoints.filter(ep =>
        board[ep.row] && board[ep.row][ep.col] !== null
      ).length;
      const aboutToCover = rotCells.filter(([cx, cy]) =>
        entryPoints.some(ep => ep.col === originCol + cx && ep.row === originRow + cy)
      ).length;
      if (entryPoints.length - alreadyTaken - aboutToCover < needEntry) {
        return { ok: false, reason: "Devi lasciare almeno un ingresso libero per l'avversario" };
      }
    }

    // Caso A: pezzo su una cella entry
    const isOnEntry = rotCells.some(([cx, cy]) =>
      entryPoints.some(ep => ep.col === originCol + cx && ep.row === originRow + cy)
    );

    const rotPorts = piece.roadPorts.map(p => ({
      side: rotSide(p.side, rot),
      cell: applyRot([p.cell], rot, off)[0],
    }));

    function entryTakenByOpponent(ep) {
      for (const side of ['N', 'S', 'E', 'W']) {
        const [dx, dz] = SIDE_DELTA[side];
        const nc2 = ep.col + dx, nr2 = ep.row + dz;
        if (nr2 < 0 || nr2 >= boardH) continue;
        if (nc2 < 0 || nc2 >= boardW) continue;
        const neighbor = board[nr2] && board[nr2][nc2];
        if (!neighbor) continue;
        if (neighbor.player === currentPlayer) continue;
        if (roadMap[nr2] && roadMap[nr2][nc2] && roadMap[nr2][nc2].has(OPPOSITE[side])) {
          return true;
        }
      }
      return false;
    }

    // Caso B: pezzo adiacente a entry via porta stradale compatibile
    const connectsEntry = rotPorts.some(port => {
      const [cx, cy] = port.cell;
      const [dx, dz] = SIDE_DELTA[port.side] || [0, 0];
      const nc = originCol + cx + dx;
      const nr = originRow + cy + dz;
      return entryPoints.some(ep =>
        ep.col === nc && ep.row === nr &&
        roadMap[nr] && roadMap[nr][nc] &&
        roadMap[nr][nc].has(OPPOSITE[port.side]) &&
        !entryTakenByOpponent(ep)
      );
    });

    if (!isOnEntry && !connectsEntry) {
      return { ok: false, reason: 'La prima mossa deve partire da un ingresso della mappa' };
    }

    // a) Bounds + occupancy
    const pieceSet = new Set(rotCells.map(([cx, cy]) => `${originCol + cx},${originRow + cy}`));
    for (const [cx, cy] of rotCells) {
      const c = originCol + cx, r = originRow + cy;
      if (c < 0 || c >= boardW || r < 0 || r >= boardH) {
        return { ok: false, reason: 'Fuori dal tabellone' };
      }
      if (board[r] && board[r][c] !== null) {
        return { ok: false, reason: 'Cella già occupata' };
      }
    }

    // b) Se NON ci si aggancia via porta a un entry: nessuna cella può essere
    //    adiacente a un pezzo già piazzato che non sia un entry point.
    if (!connectsEntry) {
      for (const [cx, cy] of rotCells) {
        const cc = originCol + cx, cr = originRow + cy;
        for (const [, [dx, dz]] of Object.entries(SIDE_DELTA)) {
          const nc = cc + dx, nr = cr + dz;
          if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
          if (pieceSet.has(`${nc},${nr}`)) continue;
          const cell = board[nr] && board[nr][nc];
          if (!cell) continue;
          const isEntryCell = entryPoints.some(ep => ep.col === nc && ep.row === nr);
          if (!isEntryCell) {
            return { ok: false, reason: 'La prima mossa non può essere adiacente a un pezzo già piazzato che non sia un ingresso' };
          }
        }
      }
    }

    // b2) Coerenza stradale sulle celle entry occupate
    for (const port of rotPorts) {
      const [cx, cy] = port.cell;
      const [dx, dz] = SIDE_DELTA[port.side] || [0, 0];
      const nc = originCol + cx + dx, nr = originRow + cy + dz;
      if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
      if (pieceSet.has(`${nc},${nr}`)) continue;
      const cell = board[nr] && board[nr][nc];
      if (!cell) continue;
      const isEntryCell = entryPoints.some(ep => ep.col === nc && ep.row === nr);
      if (isEntryCell) {
        const neighborHasPort = roadMap[nr] && roadMap[nr][nc] && roadMap[nr][nc].has(OPPOSITE[port.side]);
        if (!neighborHasPort) {
          return { ok: false, reason: "Strada non allineata con l'ingresso" };
        }
      }
    }

    // c) Controllo inverso
    for (const [cx, cy] of rotCells) {
      const cc = originCol + cx, cr = originRow + cy;
      for (const [side, [dx, dz]] of Object.entries(SIDE_DELTA)) {
        const nc = cc + dx, nr = cr + dz;
        if (nc < 0 || nc >= boardW || nr < 0 || nr >= boardH) continue;
        if (pieceSet.has(`${nc},${nr}`)) continue;
        const cell = board[nr] && board[nr][nc];
        if (!cell) continue;
        if (roadMap[nr] && roadMap[nr][nc] && roadMap[nr][nc].has(OPPOSITE[side])) {
          const hasPort = rotPorts.some(p => p.cell[0] === cx && p.cell[1] === cy && p.side === side);
          if (!hasPort) {
            return { ok: false, reason: 'Strada vicina richiede connessione' };
          }
        }
      }
    }

    return { ok: true, reason: '' };
  }

  // ── ENTRY POINT: sceglie quale ruleset usare ─────────────────────────────
  function checkPlacementRules({ piece, rot, originCol, originRow, state }) {
    if (state.hasEntryPoints && state.entryPoints && state.entryPoints.length) {
      return checkPlacementRulesEntryPoints({ piece, rot, originCol, originRow, state });
    }
    return checkPlacementRulesStandard({ piece, rot, originCol, originRow, state });
  }

  // ── HELPER: applica una mossa già validata allo stato (board/roadMap) ────
  // Usato dal server per costruire lo stato della room mossa dopo mossa,
  // a partire dalla history salvata in room.state.moves.
  function applyMoveToState(state, { piece, rot, col, row, player }) {
    const off = getPieceOff(piece.cells, rot);
    const rotCells = applyRot(piece.cells, rot, off);
    rotCells.forEach(([cx, cy]) => {
      state.board[row + cy][col + cx] = { player, deckIdx: piece.id };
    });
    piece.roadPorts.forEach(p => {
      const rc = applyRot([p.cell], rot, off)[0];
      state.roadMap[row + rc[1]][col + rc[0]].add(rotSide(p.side, rot));
    });
    state.placedPieces.push({ player, col, row, rot, deckIdx: piece.id, rotCells });
  }

  // ── HELPER: applica gli entry points di una mappa a uno stato vuoto ──────
  // Porting 1:1 della logica in map-loader.js (righe ~1511-1528): converte
  // le coordinate "esterne" della mappa (es. col:-1 = ingresso da sinistra)
  // nella cella di bordo interna corrispondente, registra una porta nel
  // roadMap di quella cella (così checkPlacementRules la vede come "già
  // collegata verso l'esterno"), e popola state.entryPoints/hasEntryPoints.
  // mapEntryPoints è l'array grezzo come arriva dal JSON della mappa:
  //   [{ col, row, side }, ...] con side = lato che guarda VERSO l'esterno
  //   nella convenzione della mappa (prima della conversione).
  function applyMapEntryPoints(state, mapEntryPoints) {
    const { boardW, boardH, roadMap } = state;
    const entryPoints = [];
    (mapEntryPoints || []).forEach(ep => {
      let boardCol, boardRow;
      if (ep.col === -1) { boardCol = 0; boardRow = ep.row; }
      else if (ep.col === boardW) { boardCol = boardW - 1; boardRow = ep.row; }
      else if (ep.row === -1) { boardCol = ep.col; boardRow = 0; }
      else { boardCol = ep.col; boardRow = boardH - 1; }

      if (boardCol < 0 || boardCol >= boardW || boardRow < 0 || boardRow >= boardH) return;

      const outwardSide = OPPOSITE[ep.side];
      roadMap[boardRow][boardCol].add(outwardSide);
      entryPoints.push({ col: boardCol, row: boardRow, side: outwardSide });
    });
    state.entryPoints = entryPoints;
    state.hasEntryPoints = entryPoints.length >= 2;
    return state;
  }

  // ── HELPER: crea uno stato vuoto pronto all'uso ──────────────────────────
  function createEmptyState(boardW, boardH, entryPoints) {
    const board = Array.from({ length: boardH }, () => Array(boardW).fill(null));
    const roadMap = Array.from({ length: boardH }, () =>
      Array(boardW).fill(null).map(() => new Set())
    );
    return {
      board, roadMap, placedPieces: [], currentPlayer: 0,
      boardW, boardH,
      entryPoints: entryPoints || [],
      hasEntryPoints: !!(entryPoints && entryPoints.length >= 2),
    };
  }

  return {
    rotateCells, getPieceOff, applyRot, rotSide,
    checkPlacementRules, checkPlacementRulesStandard, checkPlacementRulesEntryPoints,
    applyMoveToState, createEmptyState, applyMapEntryPoints,
    OPPOSITE, SIDE_DELTA,
  };
});
