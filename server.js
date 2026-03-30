const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory game rooms
const rooms = new Map();

// Generate a standard bingo card
// B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
function generateBingoCard() {
  const ranges = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75],  // O
  ];

  const card = [];
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const nums = [];
    while (nums.length < 5) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!nums.includes(n)) nums.push(n);
    }
    card.push(nums);
  }

  // Transpose so card[row][col]
  const grid = [];
  for (let row = 0; row < 5; row++) {
    grid.push(card.map(col => col[row]));
  }

  // Free space at center
  grid[2][2] = 0;
  return grid;
}

// Generate call bag: numbers 1-75 shuffled
function generateCallBag() {
  const nums = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

function checkBingo(markedGrid) {
  // Check rows
  for (let r = 0; r < 5; r++) {
    if (markedGrid[r].every(v => v)) return true;
  }
  // Check cols
  for (let c = 0; c < 5; c++) {
    if (markedGrid.every(row => row[c])) return true;
  }
  // Diagonals
  if ([0,1,2,3,4].every(i => markedGrid[i][i])) return true;
  if ([0,1,2,3,4].every(i => markedGrid[i][4-i])) return true;
  return false;
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const [, player] of room.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function getRoomState(room) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({ id, name: p.name, ready: p.ready });
  }
  return {
    roomId: room.id,
    status: room.status,
    players,
    calledNumbers: room.calledNumbers,
    currentNumber: room.currentNumber,
    winner: room.winner,
  };
}

// REST: Create room
app.post('/api/rooms', async (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  const room = {
    id: roomId,
    status: 'waiting', // waiting | playing | finished
    players: new Map(),
    callBag: generateCallBag(),
    calledNumbers: [],
    currentNumber: null,
    winner: null,
    callInterval: null,
  };
  rooms.set(roomId, room);

  const joinUrl = `${req.protocol}://${req.get('host')}/join/${roomId}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 256, margin: 2 });

  res.json({ roomId, joinUrl, qrDataUrl });
});

// REST: Get room info
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(getRoomState(room));
});

// Serve join page
app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection
wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    const { type, payload } = msg;

    if (type === 'join') {
      const { roomId, playerName } = payload;
      const room = rooms.get(roomId.toUpperCase());

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Room not found' } }));
        return;
      }

      if (room.status !== 'waiting' && !room.players.has(currentPlayerId)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Game already in progress' } }));
        return;
      }

      if (room.players.size >= 2 && !room.players.has(currentPlayerId)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Room is full (max 2 players)' } }));
        return;
      }

      const playerId = uuidv4();
      currentPlayerId = playerId;
      currentRoomId = roomId.toUpperCase();

      const isHost = room.players.size === 0;
      const card = generateBingoCard();
      const marked = Array.from({ length: 5 }, () => Array(5).fill(false));
      marked[2][2] = true; // free space

      room.players.set(playerId, {
        ws,
        name: playerName || (isHost ? 'Player 1' : 'Player 2'),
        isHost,
        card,
        marked,
        ready: false,
      });

      ws.send(JSON.stringify({
        type: 'joined',
        payload: {
          playerId,
          isHost,
          card,
          marked,
          roomState: getRoomState(room),
        },
      }));

      broadcast(room, { type: 'roomUpdate', payload: getRoomState(room) });

      if (room.players.size === 2) {
        broadcast(room, { type: 'playerJoined', payload: { message: 'Second player joined! Host can start the game.' } });
      }
    }

    else if (type === 'startGame') {
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const player = room.players.get(currentPlayerId);
      if (!player || !player.isHost) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Only the host can start the game' } }));
        return;
      }
      if (room.players.size < 2) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Need 2 players to start' } }));
        return;
      }
      if (room.status !== 'waiting') return;

      room.status = 'playing';
      broadcast(room, { type: 'gameStarted', payload: getRoomState(room) });
    }

    else if (type === 'callNumber') {
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const player = room.players.get(currentPlayerId);
      if (!player || !player.isHost) return;
      if (room.status !== 'playing') return;
      if (room.callBag.length === 0) return;

      const num = room.callBag.pop();
      room.currentNumber = num;
      room.calledNumbers.push(num);

      broadcast(room, { type: 'numberCalled', payload: { number: num, calledNumbers: room.calledNumbers } });
    }

    else if (type === 'markCell') {
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const player = room.players.get(currentPlayerId);
      if (!player) return;
      if (room.status !== 'playing') return;

      const { row, col } = payload;
      const cellValue = player.card[row][col];

      // Allow marking only if number was called (or free space)
      if (cellValue !== 0 && !room.calledNumbers.includes(cellValue)) return;

      player.marked[row][col] = true;

      ws.send(JSON.stringify({ type: 'cellMarked', payload: { row, col, marked: player.marked } }));

      // Check bingo
      if (checkBingo(player.marked)) {
        room.status = 'finished';
        room.winner = currentPlayerId;
        broadcast(room, {
          type: 'bingo',
          payload: {
            winnerId: currentPlayerId,
            winnerName: player.name,
            roomState: getRoomState(room),
          },
        });
      }
    }

    else if (type === 'playAgain') {
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const player = room.players.get(currentPlayerId);
      if (!player || !player.isHost) return;

      // Reset game
      room.status = 'waiting';
      room.callBag = generateCallBag();
      room.calledNumbers = [];
      room.currentNumber = null;
      room.winner = null;

      for (const [, p] of room.players) {
        p.card = generateBingoCard();
        p.marked = Array.from({ length: 5 }, () => Array(5).fill(false));
        p.marked[2][2] = true;
        p.ready = false;
      }

      // Send each player their new card
      for (const [pid, p] of room.players) {
        if (p.ws && p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(JSON.stringify({
            type: 'newGame',
            payload: {
              card: p.card,
              marked: p.marked,
              roomState: getRoomState(room),
            },
          }));
        }
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.players.delete(currentPlayerId);
    if (room.players.size === 0) {
      rooms.delete(currentRoomId);
    } else {
      broadcast(room, { type: 'playerLeft', payload: getRoomState(room) });
      // If game was playing and a player left, pause
      if (room.status === 'playing') {
        room.status = 'waiting';
        broadcast(room, { type: 'roomUpdate', payload: getRoomState(room) });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo server running on http://localhost:${PORT}`);
});
