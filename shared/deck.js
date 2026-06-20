// ================================================================
// DECK — 19 pezzi (9 strade + 10 con edifici)
// ================================================================
// Schema pezzo:
//   id, name, cat ('roads'|'buildings'), sq (n. quadratini)
//   cells: [[col,row], ...]  posizioni delle celle
//   roadPorts: [{side:'N|S|E|W', cell:[col,row]}, ...] uscite stradali
//   roadSegs: [{type, cells:[[col,row],...]}, ...] segmenti visivi
//   bldType (legacy), bldVariant (nuovo: hamlet/chapel/cathedral/...)
//   bldCells: [[col,row], ...] celle dove appare l'edificio (vuoto = no edif)
//
// v2: dual-mode (browser + Node). Sul server serve lo STESSO identico deck
// per validare le mosse online — un solo file, mai due copie a mano che
// rischiano di disallinearsi se un giorno cambi un pezzo.
// ================================================================
(function (root) {
  'use strict';

  const DECK = [
  // ── STRADE (9) ──────────────────────────────────────────────
  {id:1, name:'1a', cat:'roads', sq:1,
   cells:[[0,0]],
   roadPorts:[{side:'W',cell:[0,0]},{side:'E',cell:[0,0]}],
   roadSegs:[{type:'H',cells:[[0,0]]}]},

  // 2a — 2 righe:
  //   . . ║       (2,0)=V con uscita N esterna
  //   ╬ ═ ╣       (0,1)=CROSS (N,W,S esterne), (1,1)=H isolato (no porte),
  //               (2,1)=TEE_W (N,S esterne, W decorativa verso ═)
  // Totale 5 uscite esterne: N(2,0) + N(0,1)+W(0,1)+S(0,1) + N(2,1)+S(2,1) = 6 dichiarate
  // ma in realtà sono 5 connessioni reali (la W decorativa del ╣ non è esterna)
  {id:2, name:'2a', cat:'roads', sq:4,
   cells:[[2,0],[0,1],[1,1],[2,1]],
   roadPorts:[
     // (2,0) ║ V: N esterna, S interna→(2,1)
     {side:'N',cell:[2,0]},
     {side:'S',cell:[2,0]},
     // (0,1) ╬ CROSS: N, W, S esterne + E interna→(1,1) NON dichiarata (═ isolato)
     {side:'N',cell:[0,1]},
     {side:'W',cell:[0,1]},
     {side:'S',cell:[0,1]},
     // (1,1) ═ H: NESSUNA porta dichiarata (decorativo isolato)
     // (2,1) ╣ TEE_W: N, S esterne + W decorativa verso ═ NON dichiarata
     {side:'N',cell:[2,1]},
     {side:'S',cell:[2,1]},
   ],
   roadSegs:[
     {type:'V',cells:[[2,0]]},
     {type:'CROSS',cells:[[0,1]]},
     {type:'H',cells:[[1,1]]},
     {type:'TEE_W',cells:[[2,1]]},
   ]},

  // 6a — TEE_E singola cella: uscite N, E, S
  {id:6, name:'6a', cat:'roads', sq:1,
   cells:[[0,0]],
   roadPorts:[{side:'N',cell:[0,0]},{side:'E',cell:[0,0]},{side:'S',cell:[0,0]}],
   roadSegs:[{type:'TEE_E',cells:[[0,0]]}]},

  {id:8, name:'8a', cat:'roads', sq:1,
   cells:[[0,0]],
   roadPorts:[{side:'E',cell:[0,0]},{side:'S',cell:[0,0]}],
   roadSegs:[{type:'CORNER_ES',cells:[[0,0]]}]},

  // 9a — ╦╝ : TEE_S a sx (uscite W,S) + CORNER_WN a dx (uscita N)
  // Connessione interna: E(╦) ↔ W(╝) e S(╦) esterna, N(╝) esterna
  {id:9, name:'9a', cat:'roads', sq:2,
   cells:[[0,0],[1,0]],
   roadPorts:[
     // (0,0) ╦ TEE_S: W esterna, S esterna, E interna→(1,0)
     {side:'W',cell:[0,0]},
     {side:'S',cell:[0,0]},
     {side:'E',cell:[0,0]},
     // (1,0) ╝ CORNER_WN: N esterna, W interna→(0,0)
     {side:'N',cell:[1,0]},
     {side:'W',cell:[1,0]},
   ],
   roadSegs:[
     {type:'TEE_S',cells:[[0,0]]},
     {type:'CORNER_WN',cells:[[1,0]]},
   ]},

  // 10a — ╦╩ : TEE_S a sx (uscite W,S) + TEE_N a dx (uscite N,E)
  // Connessione interna: E(╦) ↔ W(╩)
  {id:10, name:'10a', cat:'roads', sq:2,
   cells:[[0,0],[1,0]],
   roadPorts:[
     // (0,0) ╦ TEE_S: W esterna, S esterna, E interna→(1,0)
     {side:'W',cell:[0,0]},
     {side:'S',cell:[0,0]},
     {side:'E',cell:[0,0]},
     // (1,0) ╩ TEE_N: N esterna, E esterna, W interna→(0,0)
     {side:'N',cell:[1,0]},
     {side:'E',cell:[1,0]},
     {side:'W',cell:[1,0]},
   ],
   roadSegs:[
     {type:'TEE_S',cells:[[0,0]]},
     {type:'TEE_N',cells:[[1,0]]},
   ]},

  // 14a — ╬╩╬ : 3 celle orizzontali
  // (0,0)=CROSS: N,W,S esterne + E interna→(1,0)
  // (1,0)=TEE_N: N esterna + W interna→(0,0) + E interna→(2,0)
  // (2,0)=CROSS: N,E,S esterne + W interna→(1,0)
  // Totale 7 uscite esterne (3+1+3)
  {id:14, name:'14a', cat:'roads', sq:3,
   cells:[[0,0],[1,0],[2,0]],
   roadPorts:[
     // (0,0) ╬ CROSS sx
     {side:'N',cell:[0,0]},
     {side:'W',cell:[0,0]},
     {side:'S',cell:[0,0]},
     {side:'E',cell:[0,0]},
     // (1,0) ╩ TEE_N centrale
     {side:'N',cell:[1,0]},
     {side:'W',cell:[1,0]},
     {side:'E',cell:[1,0]},
     // (2,0) ╬ CROSS dx
     {side:'N',cell:[2,0]},
     {side:'E',cell:[2,0]},
     {side:'S',cell:[2,0]},
     {side:'W',cell:[2,0]},
   ],
   roadSegs:[
     {type:'CROSS',cells:[[0,0]]},
     {type:'TEE_N',cells:[[1,0]]},
     {type:'CROSS',cells:[[2,0]]},
   ]},

  // 15a — 2 righe:
  //   ║ .       (0,0)=V con N esterna
  //   ╬ ═       (0,1)=CROSS (S,W esterne) + (1,1)=H (E esterna)
  // Totale 4 uscite esterne: N(0,0), W(0,1), S(0,1), E(1,1)
  {id:15, name:'15a', cat:'roads', sq:3,
   cells:[[0,0],[0,1],[1,1]],
   roadPorts:[
     // (0,0) ║ V: N esterna, S interna→(0,1)
     {side:'N',cell:[0,0]},
     {side:'S',cell:[0,0]},
     // (0,1) ╬ CROSS: S, W esterne + N interna→(0,0) + E interna→(1,1)
     {side:'S',cell:[0,1]},
     {side:'W',cell:[0,1]},
     {side:'N',cell:[0,1]},
     {side:'E',cell:[0,1]},
     // (1,1) ═ H: E esterna + W interna→(0,1)
     {side:'E',cell:[1,1]},
     {side:'W',cell:[1,1]},
   ],
   roadSegs:[
     {type:'V',cells:[[0,0]]},
     {type:'CROSS',cells:[[0,1]]},
     {type:'H',cells:[[1,1]]},
   ]},

  // 17a — ╬ singolo CROSS: uscite N, S, W, E
  {id:17, name:'17a', cat:'roads', sq:1,
   cells:[[0,0]],
   roadPorts:[
     {side:'N',cell:[0,0]},
     {side:'S',cell:[0,0]},
     {side:'W',cell:[0,0]},
     {side:'E',cell:[0,0]},
   ],
   roadSegs:[{type:'CROSS',cells:[[0,0]]}]},

  // ── EDIFICI (10) ────────────────────────────────────────────

  // 3a — ╠╗ : 1 riga
  // (0,0)=TEE_E: N,S esterne + E interna→(1,0)
  // (1,0)=CORNER_WS: S esterna + W interna→(0,0)
  // Totale 3 uscite esterne. Casette a bordo strada negli angoli liberi
  // della cella (1,0) (variante cityblock: il rendering posiziona auto
  // le case nei quadranti non occupati dalla strada CORNER_WS).
  {id:3, name:'3a', cat:'buildings', sq:2, bldType:'village', bldVariant:'cityblock',
   cells:[[0,0],[1,0]],
   roadPorts:[
     // (0,0) ╠ TEE_E
     {side:'N',cell:[0,0]},
     {side:'S',cell:[0,0]},
     {side:'E',cell:[0,0]},
     // (1,0) ╗ CORNER_WS
     {side:'S',cell:[1,0]},
     {side:'W',cell:[1,0]},
   ],
   roadSegs:[
     {type:'TEE_E',cells:[[0,0]]},
     {type:'CORNER_WS',cells:[[1,0]]},
   ],
   // Cityblock applicato SOLO alla cella (1,0): mini-edifici negli angoli liberi
   bldCells:[[1,0]]},

  // 4a — Chiesetta di campagna: strada verticale + cappella
  {id:4, name:'4a', cat:'buildings', sq:2, bldType:'church', bldVariant:'chapel',
   cells:[[0,0],[0,1]],
   roadPorts:[{side:'N',cell:[0,0]},{side:'S',cell:[0,0]}],
   roadSegs:[{type:'V',cells:[[0,0]]}],
   bldCells:[[0,1]]},

  // 5a — ═C : 1 riga, strada cieca + costruzione (fontana)
  // (0,0)=H con solo W esterna (E decorativa verso costruzione, NON dichiarata)
  // (1,0)=fontana
  // Totale 1 uscita esterna.
  {id:5, name:'5a', cat:'buildings', sq:2, bldType:'market', bldVariant:'fountain',
   cells:[[0,0],[1,0]],
   roadPorts:[
     // (0,0) ═ H: W esterna (E decorativa verso fontana - non dichiarata)
     {side:'W',cell:[0,0]},
   ],
   roadSegs:[{type:'H',cells:[[0,0]]}],
   bldCells:[[1,0]]},

  // 7a — Acquedotto romano su T-junction:
  //   ═╦═       (0,0)=H, (1,0)=TEE_S, (2,0)=H
  //   .║.       (1,1)=V
  // 3 porte esterne: W(0,0), E(2,0), S(1,1).
  // Acquedotto (3 archi) lungo il lato Nord delle 3 celle superiori.
  {id:7, name:'7a', cat:'buildings', sq:4, bldType:'factory', bldVariant:'aqueduct',
   cells:[[0,0],[1,0],[2,0],[1,1]],
   roadPorts:[
     // (0,0) ═ H: W esterna, E interna→(1,0)
     {side:'W',cell:[0,0]},
     {side:'E',cell:[0,0]},
     // (1,0) ╦ TEE_S: W interna, E interna, S interna→(1,1)
     {side:'W',cell:[1,0]},
     {side:'E',cell:[1,0]},
     {side:'S',cell:[1,0]},
     // (2,0) ═ H: W interna, E esterna
     {side:'W',cell:[2,0]},
     {side:'E',cell:[2,0]},
     // (1,1) ║ V: N interna→(1,0), S esterna
     {side:'N',cell:[1,1]},
     {side:'S',cell:[1,1]},
   ],
   roadSegs:[
     {type:'H',cells:[[0,0]]},
     {type:'TEE_S',cells:[[1,0]]},
     {type:'H',cells:[[2,0]]},
     {type:'V',cells:[[1,1]]},
   ],
   // Acquedotto solo sulle 3 celle superiori (gli archi si allineano formando l'acquedotto)
   bldCells:[[0,0],[1,0],[2,0]]},

  // 11a — 2×2 anello aperto a destra: due curve (W) chiudono l'anello,
  // due strade orizzontali escono a E.
  //   ╔═        (0,0)=CORNER_ES, (1,0)=H
  //   ╚═        (0,1)=CORNER_EN, (1,1)=H
  // 2 porte esterne: E(1,0), E(1,1). Edifici cityblock a fianco strada.
  {id:11, name:'11a', cat:'buildings', sq:4, bldType:'village', bldVariant:'cityblock',
   cells:[[0,0],[1,0],[0,1],[1,1]],
   roadPorts:[
     // (0,0) ╔ CORNER_ES: aperto a E (interna) e S (interna)
     {side:'E',cell:[0,0]},
     {side:'S',cell:[0,0]},
     // (1,0) ═ H: aperto a W (interna) e E (esterna)
     {side:'W',cell:[1,0]},
     {side:'E',cell:[1,0]},
     // (0,1) ╚ CORNER_EN: aperto a E (interna) e N (interna)
     {side:'E',cell:[0,1]},
     {side:'N',cell:[0,1]},
     // (1,1) ═ H: aperto a W (interna) e E (esterna)
     {side:'W',cell:[1,1]},
     {side:'E',cell:[1,1]},
   ],
   roadSegs:[
     {type:'CORNER_ES',cells:[[0,0]]},
     {type:'H',cells:[[1,0]]},
     {type:'CORNER_EN',cells:[[0,1]]},
     {type:'H',cells:[[1,1]]},
   ],
   bldCells:[[0,0],[1,0],[0,1],[1,1]]},

  // 12a — ═C : 1 riga, strada cieca + cappella
  // (0,0)=H con solo W esterna (E decorativa verso cappella, NON dichiarata)
  // (1,0)=cappella
  // Totale 1 uscita esterna.
  {id:12, name:'12a', cat:'buildings', sq:2, bldType:'church', bldVariant:'chapel',
   cells:[[0,0],[1,0]],
   roadPorts:[
     // (0,0) ═ H: W esterna (E decorativa verso cappella - non dichiarata)
     {side:'W',cell:[0,0]},
   ],
   roadSegs:[{type:'H',cells:[[0,0]]}],
   bldCells:[[1,0]]},

  // 13a — Supermercato con due strade a T attorno:
  //   C ╣       (0,0)=capannone (alto-sx), (1,0)=TEE_W (alto-dx)
  //   ╩ .       (0,1)=TEE_N (basso-sx)   , (1,1) = VUOTA (non parte del pezzo)
  // ╣ in (1,0): N esterna, S esterna, W decorativa (verso capannone) — non dichiarata
  // ╩ in (0,1): W esterna, E esterna, N decorativa (verso capannone) — non dichiarata
  // 4 imbocchi esterni reali: N(1,0), S(1,0), W(0,1), E(0,1)
  {id:13, name:'13a', cat:'buildings', sq:3, bldType:'market', bldVariant:'supermarket',
   cells:[[0,0],[1,0],[0,1]],
   roadPorts:[
     // (1,0) ╣ TEE_W: solo N e S esterne (W decorativa verso capannone NON dichiarata)
     {side:'N',cell:[1,0]},
     {side:'S',cell:[1,0]},
     // (0,1) ╩ TEE_N: solo W e E esterne (N decorativa verso capannone NON dichiarata)
     {side:'W',cell:[0,1]},
     {side:'E',cell:[0,1]},
   ],
   roadSegs:[
     {type:'TEE_W',cells:[[1,0]]},
     {type:'TEE_N',cells:[[0,1]]},
   ],
   bldCells:[[0,0]]},

  // 16a — Strada continua a forma di "h" con croce finale:
  //   ║ .       (0,0)=V (sbocco N esterno)
  //   ╚ ╦       (0,1)=CORNER_EN, (1,1)=TEE_S (sbocco E esterno)
  //   . ║       (1,2)=V
  //   . ╬       (1,3)=CROSS (sbocchi W, E, S esterni)
  // 5 celle, 5 imbocchi esterni: N(0,0), E(1,1), W(1,3), E(1,3), S(1,3)
  // Edifici cityblock a fianco strada in ogni cella.
  {id:16, name:'16a', cat:'buildings', sq:5, bldType:'village', bldVariant:'cityblock',
   cells:[[0,0],[0,1],[1,1],[1,2],[1,3]],
   roadPorts:[
     // (0,0) ║ V: N esterna, S interna → (0,1)
     {side:'N',cell:[0,0]},
     {side:'S',cell:[0,0]},
     // (0,1) ╚ CORNER_EN: N interna → (0,0), E interna → (1,1)
     {side:'N',cell:[0,1]},
     {side:'E',cell:[0,1]},
     // (1,1) ╦ TEE_S: W interna → (0,1), E esterna, S interna → (1,2)
     {side:'W',cell:[1,1]},
     {side:'E',cell:[1,1]},
     {side:'S',cell:[1,1]},
     // (1,2) ║ V: N interna → (1,1), S interna → (1,3)
     {side:'N',cell:[1,2]},
     {side:'S',cell:[1,2]},
     // (1,3) ╬ CROSS: N interna → (1,2), W esterna, E esterna, S esterna
     {side:'N',cell:[1,3]},
     {side:'W',cell:[1,3]},
     {side:'E',cell:[1,3]},
     {side:'S',cell:[1,3]},
   ],
   roadSegs:[
     {type:'V',cells:[[0,0]]},
     {type:'CORNER_EN',cells:[[0,1]]},
     {type:'TEE_S',cells:[[1,1]]},
     {type:'V',cells:[[1,2]]},
     {type:'CROSS',cells:[[1,3]]},
   ],
   bldCells:[[0,0],[0,1],[1,1],[1,2],[1,3]]},

  // 18a — CROCE 5 celle stradali con 10 sbocchi esterni:
  //   . ╬ .       (1,0)=CROSS — esterne: N, W, E (S interna→(1,1))
  //   ╬ ╬ ╬       (0,1)=CROSS — esterne: N, W, S (E interna→(1,1))
  //               (1,1)=CROSS — TUTTE interne (centrale, nessun sbocco)
  //               (2,1)=CROSS — esterne: N, E, S (W interna→(1,1))
  //   . ║ .       (1,2)=V — esterna: S (N interna→(1,1))
  // 10 sbocchi esterni totali. Edifici cityblock attorno a ogni strada.
  {id:18, name:'18a', cat:'buildings', sq:5, bldType:'village', bldVariant:'cityblock',
   cells:[[1,0],[0,1],[1,1],[2,1],[1,2]],
   roadPorts:[
     // (1,0) ╬ CROSS top: N, W, E esterne + S interna → (1,1)
     {side:'N',cell:[1,0]},
     {side:'W',cell:[1,0]},
     {side:'E',cell:[1,0]},
     {side:'S',cell:[1,0]},
     // (0,1) ╬ CROSS left: N, W, S esterne + E interna → (1,1)
     {side:'N',cell:[0,1]},
     {side:'W',cell:[0,1]},
     {side:'S',cell:[0,1]},
     {side:'E',cell:[0,1]},
     // (1,1) ╬ CROSS center: tutte interne
     {side:'N',cell:[1,1]},
     {side:'W',cell:[1,1]},
     {side:'E',cell:[1,1]},
     {side:'S',cell:[1,1]},
     // (2,1) ╬ CROSS right: N, E, S esterne + W interna → (1,1)
     {side:'N',cell:[2,1]},
     {side:'E',cell:[2,1]},
     {side:'S',cell:[2,1]},
     {side:'W',cell:[2,1]},
     // (1,2) ║ V bottom: S esterna + N interna → (1,1)
     {side:'S',cell:[1,2]},
     {side:'N',cell:[1,2]},
   ],
   roadSegs:[
     {type:'CROSS',cells:[[1,0]]},
     {type:'CROSS',cells:[[0,1]]},
     {type:'CROSS',cells:[[1,1]]},
     {type:'CROSS',cells:[[2,1]]},
     {type:'V',cells:[[1,2]]},
   ],
   bldCells:[[1,0],[0,1],[1,1],[2,1],[1,2]]},

  // 19a — "T" rovesciata: 4 celle con strada a doppio incrocio:
  //   ║ . .       (0,0)=V
  //   ╬═╬         (0,1)=CROSS, (1,1)=H, (2,1)=CROSS
  // 6 porte esterne: N(0,0), W(0,1), S(0,1), N(2,1), E(2,1), S(2,1)
  // Edifici cityblock (case, fontane, fabbriche) a fianco strada in ogni cella.
  {id:19, name:'19a', cat:'buildings', sq:4, bldType:'church', bldVariant:'cityblock',
   cells:[[0,0],[0,1],[1,1],[2,1]],
   roadPorts:[
     // (0,0) ║ V: N esterna, S interna → (0,1)
     {side:'N',cell:[0,0]},
     {side:'S',cell:[0,0]},
     // (0,1) ╬ CROSS: N interna → (0,0), W esterna, S esterna, E interna → (1,1)
     {side:'N',cell:[0,1]},
     {side:'W',cell:[0,1]},
     {side:'S',cell:[0,1]},
     {side:'E',cell:[0,1]},
     // (1,1) ═ H: W interna → (0,1), E interna → (2,1)
     {side:'W',cell:[1,1]},
     {side:'E',cell:[1,1]},
     // (2,1) ╬ CROSS: W interna → (1,1), N esterna, E esterna, S esterna
     {side:'W',cell:[2,1]},
     {side:'N',cell:[2,1]},
     {side:'E',cell:[2,1]},
     {side:'S',cell:[2,1]},
   ],
   roadSegs:[
     {type:'V',cells:[[0,0]]},
     {type:'CROSS',cells:[[0,1]]},
     {type:'H',cells:[[1,1]]},
     {type:'CROSS',cells:[[2,1]]},
   ],
   bldCells:[[0,0],[0,1],[1,1],[2,1]]},
  ];

  if (typeof module === 'object' && module.exports) {
    module.exports = DECK;
  } else {
    root.RC = root.RC || {};
    root.RC.DECK = DECK;
    // Stato deck dei giocatori (Set di id già usati) — solo client, UI/turno.
    root.RC.playerDecks = [
      { usedIds: new Set() },
      { usedIds: new Set() },
    ];
  }
})(typeof window !== 'undefined' ? window : this);
