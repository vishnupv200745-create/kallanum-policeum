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
function leaveCurrent(socket) {
  const room = getRoomFor(socket);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  if (room.phase !== "lobby" && room.players.size < 2) {
    room.phase = "lobby";
    room.round = 0;
    room.secrets = new Map();
    room.message = "Players left. The room returned to the lobby.";
  }
  emitRoom(room);
}

function roleDeck(playerCount) {
  // Each round always has one police and one thief. Extra roles are optional flavor roles.
  const roles = ["Police", "Thief"];
  const extras = ["King", "Minister", "Detective", "Citizen"];
  while (roles.length < playerCount) roles.push(extras[(roles.length - 2) % extras.length]);
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
    room.message = "At least 2 players are needed.";
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
  room.message = "The papers have been shuffled. Everyone, pick your paper!";
  room.players.forEach(p => { p.ready = false; });
  room.players.forEach(p => io.to(p.id).emit("round:new", { round: room.round }));
  emitRoom(room);
}
function finishRound(room, guessId) {
  const thief = [...room.secrets.entries()].find(([, role]) => role === "Thief");
  if (!thief) return;
  const thiefId = thief[0];
  const correct = guessId === thiefId;
  const police = room.players.get(room.policeId);
  if (correct && police) police.score += 2;
  if (!correct && room.players.has(thiefId)) room.players.get(thiefId).score += 2;
  room.lastResult = {
    policeId: room.policeId,
    thiefId,
    guessId,
    correct,
    policeName: room.players.get(room.policeId)?.name || "Police",
    thiefName: room.players.get(thiefId)?.name || "Thief",
    guessedName: room.players.get(guessId)?.name || "Unknown"
  };
  room.phase = "result";
  room.message = correct ? "Correct! The police caught the thief." : "Wrong guess! The thief escaped.";
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("rooms:list", () => {
    socket.emit("rooms:list", [...rooms.values()]
      .filter(r => r.privacy === "public" && r.phase === "lobby")
      .map(r => ({
        code: r.code, name: r.name, count: r.players.size,
        roundsTotal: r.roundsTotal
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
      message: "Waiting for friends to join."
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
    if (!room) return sendError(socket, "Room not found. Check the room code.");
    if (room.phase !== "lobby") return sendError(socket, "This game has already started.");
    if (room.players.size >= 12) return sendError(socket, "This room is full (maximum 12 players).");
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
  });

  socket.on("room:join-public", payload => {
    const code = String(payload?.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.privacy !== "public") return sendError(socket, "That public room is no longer available.");
    socket.emit("room:join", { code, playerName: payload?.playerName });
  });

  socket.on("game:start", () => {
    const room = getRoomFor(socket);
    if (!room) return sendError(socket, "Join a room first.");
    if (room.hostId !== socket.id) return sendError(socket, "Only the room host can start the game.");
    if (room.players.size < 2) return sendError(socket, "Invite at least one friend before starting.");
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
    room.message = "Players are picking their shuffled papers…";
    emitRoom(room);
    const everyonePicked = [...room.players.values()].every(p => p.ready);
    if (everyonePicked) {
      room.phase = "police-turn";
      room.message = "Everyone has picked. Police, choose who you think is the thief!";
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
    if (socket.id !== room.policeId) return sendError(socket, "Only the police can make the guess.");
    const guessId = String(payload?.playerId || "");
    if (!room.players.has(guessId) || guessId === socket.id) return sendError(socket, "Choose another player.");
    room.policeGuess = guessId;
    finishRound(room, guessId);
  });

  socket.on("game:next-round", () => {
    const room = getRoomFor(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return sendError(socket, "Only the host can continue.");
    if (room.phase !== "result") return;
    if (room.round >= room.roundsTotal) {
      room.phase = "finished";
      room.message = "Game over! Final scores are ready.";
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
    room.message = "Back in the lobby. Start a new game when ready.";
    emitRoom(room);
  });

  socket.on("room:leave", () => {
    leaveCurrent(socket);
    socket.emit("room:left");
    io.emit("rooms:changed");
  });

  socket.on("disconnect", () => {
    leaveCurrent(socket);
    namesBySocket.delete(socket.id);
    io.emit("rooms:changed");
  });
});

server.listen(PORT, () => console.log(`Kallanum Policeum is running on port ${PORT}`));
