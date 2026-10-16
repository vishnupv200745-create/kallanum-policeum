const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();
const namesBySocket = new Map();
const matchmakingQueue = [];
let matchmakingTimer = null;
let matchmakingTick = null;
let matchmakingDeadline = 0;

function makeCode() {
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (rooms.has(code));
  return code;
}
function cleanName(value) {
  return String(value || "Player").trim().replace(/\s+/g, " ").slice(0, 18) || "Player";
}
function publicRoom(room) {
  return {
    autoManaged: !!room.autoManaged,
    code: room.code,
    name: room.name,
    privacy: room.privacy,
    roundsTotal: room.roundsTotal,
    round: room.round,
    phase: room.phase,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, connected: true,
      ready: !!p.ready
    })),
    lastResult: room.lastResult,
    policeId: room.policeId,
    policeGuess: room.policeGuess,
    message: room.message
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function sendError(socket, message) {
  socket.emit("app:error", message);
}
function getRoomFor(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function clearAutoStart(room) {
  if (room && room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
}
function scheduleAutoRoomStart(room) {
  if (!room || !room.autoManaged || room.phase !== "lobby" || room.players.size < 2 || room.autoStartTimer) return;
  room.message = "The game will start automatically in 10 seconds.";
  emitRoom(room);
  room.autoStartTimer = setTimeout(() => {
    room.autoStartTimer = null;
    if (!rooms.has(room.code) || room.phase !== "lobby" || room.players.size < 2) return;
    room.round = 1;
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    startRound(room);
  }, 10000);
}
function leaveCurrent(socket) {
  const room = getRoomFor(socket);
  if (!room) return;
  socket.to(room.code).emit("voice:peer-left", { peerId: socket.id });
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (!room.players.size) {
    clearAutoStart(room);
    if (room.autoManaged) {
      room.phase = "lobby";
      room.round = 0;
      room.hostId = null;
      room.secrets = new Map();
      room.policeId = null;
      room.policeGuess = null;
      room.lastResult = null;
      room.message = "Join this room to play.";
      io.emit("rooms:changed");
    } else {
      rooms.delete(room.code);
    }
    return;
  }
  if (room.autoManaged && room.players.size < 2 && room.phase === "lobby") clearAutoStart(room);
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  if (room.phase !== "lobby" && room.players.size < 2) {
    room.phase = "lobby";
    room.round = 0;
    room.secrets = new Map();
    room.message = "ചിലർ പുറത്തുപോയി. മുറി വീണ്ടും കാത്തിരിപ്പ് നിലയിലായി.";
  }
  emitRoom(room);
  io.emit("rooms:changed");
}

function broadcastMatchmakingStatus() {
  const waiting = matchmakingQueue.length;
  const seconds = matchmakingDeadline ? Math.max(0, Math.ceil((matchmakingDeadline - Date.now()) / 1000)) : null;
  for (const id of matchmakingQueue) {
    io.to(id).emit("matchmaking:status", {
      queued: true,
      waiting,
      maxPlayers: 15,
      seconds,
      message: waiting < 2
        ? "Waiting for real players… At least 2 players are needed."
        : `Match starts in ${seconds ?? 10} seconds · ${waiting} real players waiting.`
    });
  }
}
function stopMatchmakingClock() {
  if (matchmakingTimer) clearTimeout(matchmakingTimer);
  if (matchmakingTick) clearInterval(matchmakingTick);
  matchmakingTimer = null;
  matchmakingTick = null;
  matchmakingDeadline = 0;
}
function startMatchmakingClock() {
  if (matchmakingTimer || matchmakingQueue.length < 2) {
    broadcastMatchmakingStatus();
    return;
  }
  matchmakingDeadline = Date.now() + 10000;
  broadcastMatchmakingStatus();
  matchmakingTick = setInterval(broadcastMatchmakingStatus, 1000);
  matchmakingTimer = setTimeout(() => {
    stopMatchmakingClock();
    const valid = matchmakingQueue.filter(id => io.sockets.sockets.has(id));
    matchmakingQueue.splice(0, matchmakingQueue.length, ...valid);
    if (matchmakingQueue.length < 2) {
      broadcastMatchmakingStatus();
      return;
    }
    const ids = matchmakingQueue.splice(0, 15);
    const code = makeCode();
    const roundsTotal = 5;
    const room = {
      code, name: "Quick Match", privacy: "public", roundsTotal, round: 1,
      phase: "lobby", hostId: ids[0], players: new Map(), secrets: new Map(),
      policeId: null, policeGuess: null, lastResult: null,
      message: "Quick match ready. Starting your game…"
    };
    for (const id of ids) {
      const playerSocket = io.sockets.sockets.get(id);
      if (!playerSocket) continue;
      const name = namesBySocket.get(id) || "Player";
      room.players.set(id, { id, name, score: 0, ready: false });
      playerSocket.data.roomCode = code;
      playerSocket.join(code);
      playerSocket.emit("matchmaking:status", { queued: false, message: "Match found! Joining game…" });
      playerSocket.emit("room:joined", { code, playerId: id });
    }
    if (room.players.size >= 2) {
      rooms.set(code, room);
      emitRoom(room);
      io.emit("rooms:changed");
      room.phase = "choosing";
      startRound(room);
    }
    if (matchmakingQueue.length >= 2) startMatchmakingClock();
    else broadcastMatchmakingStatus();
  }, 10000);
}
function removeFromMatchmaking(socket) {
  const index = matchmakingQueue.indexOf(socket.id);
  if (index >= 0) matchmakingQueue.splice(index, 1);
  socket.emit("matchmaking:status", { queued: false, message: "You left matchmaking." });
  if (matchmakingQueue.length < 2) stopMatchmakingClock();
  broadcastMatchmakingStatus();
}

function roleDeck(playerCount) {
  // Each round always has one police and one thief. Extra roles are optional flavor roles.
  const roles = ["Police", "Thief", "King", "Minister", "Queen", "Doctor", "Detective", "Guard", "Milkman", "Farmer", "Trader", "Teacher", "Soldier", "Fisherman", "Citizen"];
  return roles.slice(0, playerCount);
}
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function startRound(room) {
  const players = [...room.players.values()];
  if (players.length < 2) {
    room.phase = "lobby";
    room.message = "കളിക്കാൻ കുറഞ്ഞത് 2 പേർ വേണം.";
    emitRoom(room);
    return;
  }
  const deck = shuffle(roleDeck(players.length));
  room.secrets = new Map();
  players.forEach((player, index) => {
    room.secrets.set(player.id, deck[index]);
  });
  room.policeId = players.find(p => room.secrets.get(p.id) === "Police").id;
  room.policeGuess = null;
  room.lastResult = null;
  room.phase = "choosing";
  room.message = "കടലാസുകൾ കലക്കി തയ്യാറാക്കി! എല്ലാവരും ഓരോ കടലാസ് തിരഞ്ഞെടുക്കൂ.";
  room.players.forEach(p => { p.ready = false; });
  room.players.forEach(p => io.to(p.id).emit("round:new", { round: room.round }));
  emitRoom(room);
  io.emit("rooms:changed");
}
function finishRound(room, guessId) {
  const thief = [...room.secrets.entries()].find(([, role]) => role === "Thief");
  if (!thief) return;
  const thiefId = thief[0];
  const correct = guessId === thiefId;
  const police = room.players.get(room.policeId);
  // Traditional role points: King 1000, Minister 500.
  // Police gets 100 for a correct guess; otherwise the thief gets 100.
  for (const [playerId, role] of room.secrets.entries()) {
    const player = room.players.get(playerId);
    if (!player) continue;
    if (role === "King") player.score += 1000;
    if (role === "Minister") player.score += 500;
  }
  if (correct && police) police.score += 100;
  if (!correct && room.players.has(thiefId)) room.players.get(thiefId).score += 100;
  room.lastResult = {
    policeId: room.policeId,
    thiefId,
    guessId,
    correct,
    policeName: room.players.get(room.policeId)?.name || "പോലീസ്",
    thiefName: room.players.get(thiefId)?.name || "കള്ളൻ",
    guessedName: room.players.get(guessId)?.name || "അറിയില്ല"
  };
  room.phase = "result";
  room.message = correct ? "Correct! The Police caught the Thief." : "Wrong guess! The Thief gets 100 points.";
  emitRoom(room);
  if (room.autoManaged) {
    setTimeout(() => {
      if (!rooms.has(room.code) || room.phase !== "result") return;
      if (room.players.size < 2) {
        room.phase = "lobby"; room.round = 0; room.secrets = new Map();
        room.message = "Join this room to play."; emitRoom(room); io.emit("rooms:changed"); return;
      }
      if (room.round < room.roundsTotal) {
        room.round += 1;
        startRound(room);
      } else {
        room.phase = "finished";
        room.message = "Game finished! The next game will start automatically.";
        emitRoom(room);
        setTimeout(() => {
          if (!rooms.has(room.code) || room.players.size < 2) {
            if (rooms.has(room.code)) { room.phase = "lobby"; room.round = 0; room.message = "Join this room to play."; emitRoom(room); io.emit("rooms:changed"); }
            return;
          }
          room.phase = "lobby"; room.round = 0; room.lastResult = null; room.policeId = null; room.policeGuess = null;
          room.players.forEach(p => { p.score = 0; p.ready = false; });
          room.message = "New game starts automatically in 10 seconds.";
          emitRoom(room); io.emit("rooms:changed"); scheduleAutoRoomStart(room);
        }, 4000);
      }
    }, 4000);
  }
}

io.on("connection", socket => {
  socket.on("matchmaking:join", payload => {
    const name = cleanName(payload?.playerName);
    if (!name || name === "Player") return sendError(socket, "Please enter your name first.");
    leaveCurrent(socket);
    removeFromMatchmaking(socket);
    namesBySocket.set(socket.id, name);
    if (matchmakingQueue.length >= 1000) return sendError(socket, "Matchmaking is busy. Please try again shortly.");
    matchmakingQueue.push(socket.id);
    socket.emit("matchmaking:status", { queued: true, waiting: matchmakingQueue.length, maxPlayers: 15, seconds: matchmakingQueue.length >= 2 ? 10 : null, message: matchmakingQueue.length < 2 ? "Waiting for real players… At least 2 players are needed." : "Players found. Match starts in 10 seconds." });
    startMatchmakingClock();
  });
  socket.on("matchmaking:cancel", () => removeFromMatchmaking(socket));
  socket.on("rooms:list", () => {
    socket.emit("rooms:list", [...rooms.values()]
      .filter(r => r.privacy === "public" && r.phase === "lobby")
      .map(r => ({
        code: r.code, name: r.name, count: r.players.size,
        roundsTotal: r.roundsTotal, autoManaged: !!r.autoManaged
      })));
  });

  socket.on("room:create", payload => {
    leaveCurrent(socket);
    const name = cleanName(payload?.playerName);
    const roomName = String(payload?.roomName || "Friends Room").trim().slice(0, 28) || "Friends Room";
    const roundsTotal = Math.max(1, Math.min(30, Number(payload?.roundsTotal) || 5));
    const privacy = payload?.privacy === "public" ? "public" : "private";
    const code = makeCode();
    const room = {
      code, name: roomName, privacy, roundsTotal, round: 0,
      phase: "lobby", hostId: socket.id,
      players: new Map(), secrets: new Map(),
      policeId: null, policeGuess: null, lastResult: null,
      message: "സുഹൃത്തുക്കൾ ചേരാൻ കാത്തിരിക്കുന്നു…"
    };
    room.players.set(socket.id, { id: socket.id, name, score: 0, ready: false });
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    namesBySocket.set(socket.id, name);
    socket.emit("room:joined", { code, playerId: socket.id });
    emitRoom(room);
    io.emit("rooms:changed");
  });

  socket.on("room:join", payload => {
    const code = String(payload?.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendError(socket, "മുറി കണ്ടെത്താനായില്ല. റൂം കോഡ് പരിശോധിക്കൂ.");
    if (room.phase !== "lobby") return sendError(socket, "കളി ഇതിനകം തുടങ്ങിയിട്ടുണ്ട്.");
    if (room.players.size >= 15) return sendError(socket, "മുറി നിറഞ്ഞു (പരമാവധി 15 പേർ).");
    leaveCurrent(socket);
    const name = cleanName(payload?.playerName);
    room.players.set(socket.id, { id: socket.id, name, score: 0, ready: false });
    socket.data.roomCode = code;
    socket.join(code);
    namesBySocket.set(socket.id, name);
    socket.emit("room:joined", { code, playerId: socket.id });
    room.message = `${name} joined the room.`;
    emitRoom(room);
    io.emit("rooms:changed");
    if (room.autoManaged) scheduleAutoRoomStart(room);
  });

  socket.on("voice:join", () => {
    const room = getRoomFor(socket);
    if (!room) return;
    socket.emit("voice:peers", [...room.players.keys()].filter(id => id !== socket.id));
    socket.to(room.code).emit("voice:peer-joined", { peerId: socket.id });
  });
  socket.on("voice:signal", payload => {
    const room = getRoomFor(socket);
    if (!room || !payload || !payload.to || !room.players.has(payload.to)) return;
    io.to(payload.to).emit("voice:signal", { from: socket.id, signal: payload.signal });
  });
  socket.on("voice:leave", () => {
    const room = getRoomFor(socket);
    if (room) socket.to(room.code).emit("voice:peer-left", { peerId: socket.id });
  });

  socket.on("room:join-public", payload => {
    const code = String(payload?.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.privacy !== "public") return sendError(socket, "That public room is no longer available.");
    socket.emit("room:join", { code, playerName: payload?.playerName });
  });

  socket.on("game:start", () => {
    const room = getRoomFor(socket);
    if (!room) return sendError(socket, "Please join a room first.");
    if (room.autoManaged) return sendError(socket, "This public room starts automatically.");
    if (room.hostId !== socket.id) return sendError(socket, "Only the room host can start the game.");
    if (room.players.size < 2) return sendError(socket, "കളി തുടങ്ങാൻ കുറഞ്ഞത് ഒരു സുഹൃത്തിനെയെങ്കിലും ചേർക്കൂ.");
    room.round = 1;
    room.players.forEach(p => { p.score = 0; });
    startRound(room);
  });

  socket.on("paper:pick", () => {
    const room = getRoomFor(socket);
    if (!room || room.phase !== "choosing") return;
    if (!room.players.has(socket.id)) return;
    if (room.players.get(socket.id).ready) return;
    room.players.get(socket.id).ready = true;
    socket.emit("role:private", {
      role: room.secrets.get(socket.id),
      round: room.round,
      roomCode: room.code
    });
    room.message = "കളിക്കാർ കലക്കിയ കടലാസുകളിൽ നിന്ന് തിരഞ്ഞെടുക്കുന്നു…";
    emitRoom(room);
    const everyonePicked = [...room.players.values()].every(p => p.ready);
    if (everyonePicked) {
      room.phase = "police-turn";
      room.message = "എല്ലാവരും കടലാസ് എടുത്തു. പോലീസ്, കള്ളനെന്ന് സംശയിക്കുന്ന ആളെ തിരഞ്ഞെടുക്കൂ!";
      emitRoom(room);
      io.to(room.policeId).emit("police:turn", {
        players: [...room.players.values()].filter(p => p.id !== room.policeId)
          .map(p => ({ id: p.id, name: p.name }))
      });
    }
  });

  socket.on("police:guess", payload => {
    const room = getRoomFor(socket);
    if (!room || room.phase !== "police-turn") return;
    if (socket.id !== room.policeId) return sendError(socket, "പോലീസിന് മാത്രമേ സംശയിക്കുന്ന ആളെ തിരഞ്ഞെടുക്കാനാകൂ.");
    const guessId = String(payload?.playerId || "");
    if (!room.players.has(guessId) || guessId === socket.id) return sendError(socket, "മറ്റൊരു കളിക്കാരനെ തിരഞ്ഞെടുക്കൂ.");
    room.policeGuess = guessId;
    finishRound(room, guessId);
  });

  socket.on("game:next-round", () => {
    const room = getRoomFor(socket);
    if (!room) return;
    if (room.autoManaged) return sendError(socket, "Public rooms advance automatically.");
    if (room.hostId !== socket.id) return sendError(socket, "Only the host can advance the round.");
    if (room.phase !== "result") return;
    if (room.round >= room.roundsTotal) {
      room.phase = "finished";
      room.message = "Game finished! Final scores are below.";
      emitRoom(room);
    } else {
      room.round += 1;
      startRound(room);
    }
  });

  socket.on("game:back-to-lobby", () => {
    const room = getRoomFor(socket);
    if (!room || room.hostId !== socket.id) return;
    room.phase = "lobby";
    room.round = 0;
    room.secrets = new Map();
    room.lastResult = null;
    room.policeId = null;
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    room.message = "വീണ്ടും കാത്തിരിപ്പ് മുറിയിൽ. തയ്യാറാകുമ്പോൾ കളി തുടങ്ങൂ.";
    emitRoom(room);
  });

  socket.on("room:leave", () => {
    leaveCurrent(socket);
    socket.emit("room:left");
    io.emit("rooms:changed");
  });

  socket.on("disconnect", () => {
    const queueIndex = matchmakingQueue.indexOf(socket.id);
    if (queueIndex >= 0) matchmakingQueue.splice(queueIndex, 1);
    if (matchmakingQueue.length < 2) stopMatchmakingClock(); else broadcastMatchmakingStatus();
    leaveCurrent(socket);
    namesBySocket.delete(socket.id);
    io.emit("rooms:changed");
  });
});

// Keep ten public rooms available. They contain real players only and never add bots.
for (let i = 1; i <= 10; i++) {
  const code = makeCode();
  rooms.set(code, {
    code, name: `Kerala Public Room ${i}`, privacy: "public", roundsTotal: 5, round: 0,
    phase: "lobby", hostId: null, players: new Map(), secrets: new Map(),
    policeId: null, policeGuess: null, lastResult: null,
    autoManaged: true, autoStartTimer: null, message: "Join this room to play."
  });
}

server.listen(PORT, () => console.log(`Kallanum Policeum is running on port ${PORT}`));
