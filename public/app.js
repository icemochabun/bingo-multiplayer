/* ===== STATE ===== */
const state = {
  roomId: null,
  playerId: null,
  isHost: false,
  card: null,
  marked: null,
  calledNumbers: [],
  roomStatus: 'waiting',
  ws: null,
};

/* ===== SCREEN MANAGEMENT ===== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ===== BINGO LETTER ===== */
function bingoLetter(n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  return 'O';
}

/* ===== RENDER BINGO CARD ===== */
function renderCard(card, marked, calledNumbers) {
  const grid = document.getElementById('bingo-card');
  grid.innerHTML = '';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const val = card[row][col];
      const isMarked = marked[row][col];
      const isFree = val === 0;
      const isCalled = calledNumbers.includes(val);

      const cell = document.createElement('div');
      cell.className = 'bingo-cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      if (isFree) {
        cell.classList.add('free', 'marked');
        cell.textContent = 'FREE';
      } else {
        cell.textContent = val;
        if (isMarked) {
          cell.classList.add('marked');
        } else if (isCalled) {
          cell.classList.add('called-but-unmarked');
        }
      }

      if (!isMarked && !isFree && state.roomStatus === 'playing') {
        cell.addEventListener('click', () => onCellClick(row, col));
      }

      grid.appendChild(cell);
    }
  }
}

/* ===== UPDATE CALLED NUMBERS DISPLAY ===== */
function renderCalledNumbers(calledNumbers) {
  const container = document.getElementById('called-numbers-grid');
  container.innerHTML = '';
  calledNumbers.forEach((n, i) => {
    const chip = document.createElement('div');
    chip.className = 'called-chip';
    if (i === calledNumbers.length - 1) chip.classList.add('latest');
    chip.textContent = n;
    container.appendChild(chip);
  });
}

/* ===== UPDATE CURRENT NUMBER ===== */
function showCurrentNumber(n) {
  if (n === null) {
    document.getElementById('num-letter').textContent = '-';
    document.getElementById('num-value').textContent = '--';
  } else {
    document.getElementById('num-letter').textContent = bingoLetter(n);
    document.getElementById('num-value').textContent = n;
  }
}

/* ===== UPDATE PLAYER LIST (LOBBY) ===== */
function renderPlayers(players) {
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'player-item';
    const badge = i === 0 ? '<span class="badge badge-host">Host</span>' : '<span class="badge badge-guest">Guest</span>';
    item.innerHTML = `<span class="player-name">${escapeHtml(p.name)}</span>${badge}`;
    list.appendChild(item);
  });
}

/* ===== UPDATE VS BADGE ===== */
function renderVsBadge(players) {
  const badge = document.getElementById('vs-badge');
  if (players.length >= 2) {
    badge.textContent = `${players[0].name} vs ${players[1].name}`;
  } else {
    badge.textContent = '';
  }
}

/* ===== WEBSOCKET ===== */
function connectWS(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.onopen = onOpen;

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    document.getElementById('game-status-label').textContent = 'Disconnected';
  };

  ws.onerror = () => {
    alert('Connection error. Please refresh.');
  };
}

function sendWS(type, payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, payload }));
  }
}

/* ===== HANDLE INCOMING MESSAGES ===== */
function handleMessage(msg) {
  const { type, payload } = msg;

  if (type === 'error') {
    alert(payload.message);
    return;
  }

  if (type === 'joined') {
    state.playerId = payload.playerId;
    state.isHost = payload.isHost;
    state.card = payload.card;
    state.marked = payload.marked;
    state.roomStatus = payload.roomState.status;
    state.calledNumbers = payload.roomState.calledNumbers;

    showScreen('screen-game');
    document.getElementById('game-room-code').textContent = state.roomId;
    renderCard(state.card, state.marked, state.calledNumbers);
    showCurrentNumber(payload.roomState.currentNumber);
    renderCalledNumbers(state.calledNumbers);
    renderVsBadge(payload.roomState.players);
    updateGameUI(payload.roomState);
  }

  else if (type === 'roomUpdate') {
    renderPlayers(payload.players);
    renderVsBadge(payload.players);
    updateGameUI(payload);

    // Enable start button if 2 players
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      if (payload.players.length >= 2) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Game!';
      } else {
        startBtn.disabled = true;
        startBtn.textContent = 'Waiting for player 2…';
      }
    }
  }

  else if (type === 'playerJoined') {
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Game!';
    }
  }

  else if (type === 'gameStarted') {
    state.roomStatus = 'playing';
    document.getElementById('waiting-overlay').classList.add('hidden');
    document.getElementById('game-status-label').textContent = 'Game in progress';
    updateGameUI(payload);
    renderCard(state.card, state.marked, state.calledNumbers);
  }

  else if (type === 'numberCalled') {
    state.calledNumbers = payload.calledNumbers;
    showCurrentNumber(payload.number);
    renderCalledNumbers(state.calledNumbers);
    // Highlight callable cells
    renderCard(state.card, state.marked, state.calledNumbers);
  }

  else if (type === 'cellMarked') {
    state.marked = payload.marked;
    renderCard(state.card, state.marked, state.calledNumbers);
  }

  else if (type === 'bingo') {
    state.roomStatus = 'finished';
    const isWinner = payload.winnerId === state.playerId;
    showWinnerOverlay(payload.winnerName, isWinner);
    document.getElementById('btn-play-again').style.display = state.isHost ? 'block' : 'none';
  }

  else if (type === 'playerLeft') {
    state.roomStatus = payload.status;
    document.getElementById('game-status-label').textContent = 'Opponent disconnected';
    document.getElementById('waiting-overlay').classList.remove('hidden');
    document.getElementById('waiting-text').textContent = 'Opponent disconnected. Waiting…';
  }

  else if (type === 'newGame') {
    state.card = payload.card;
    state.marked = payload.marked;
    state.calledNumbers = [];
    state.roomStatus = payload.roomState.status;

    document.getElementById('winner-overlay').classList.add('hidden');
    showCurrentNumber(null);
    renderCalledNumbers([]);
    renderCard(state.card, state.marked, []);
    updateGameUI(payload.roomState);

    if (!state.isHost) {
      document.getElementById('waiting-overlay').classList.remove('hidden');
      document.getElementById('waiting-text').textContent = 'Waiting for host to start…';
    }
  }
}

function updateGameUI(roomState) {
  const callBtn = document.getElementById('btn-call');
  if (callBtn) {
    callBtn.style.display = (state.isHost && roomState.status === 'playing') ? 'block' : 'none';
  }

  if (roomState.status === 'waiting' && !state.isHost) {
    document.getElementById('waiting-overlay').classList.remove('hidden');
    document.getElementById('waiting-text').textContent = 'Waiting for host to start…';
  } else if (roomState.status === 'playing') {
    document.getElementById('waiting-overlay').classList.add('hidden');
  }

  const statusLabel = document.getElementById('game-status-label');
  if (statusLabel) {
    if (roomState.status === 'waiting') statusLabel.textContent = 'Waiting to start…';
    else if (roomState.status === 'playing') statusLabel.textContent = 'Game in progress';
    else if (roomState.status === 'finished') statusLabel.textContent = 'Game over';
  }
}

function showWinnerOverlay(winnerName, isWinner) {
  const overlay = document.getElementById('winner-overlay');
  const text = document.getElementById('winner-text');
  overlay.classList.remove('hidden');
  if (isWinner) {
    text.textContent = 'BINGO! You win! 🎉';
  } else {
    text.textContent = `${escapeHtml(winnerName)} got BINGO!`;
  }
}

/* ===== CELL CLICK ===== */
function onCellClick(row, col) {
  if (state.roomStatus !== 'playing') return;
  sendWS('markCell', { row, col });
}

/* ===== CREATE GAME (HOST) ===== */
async function createGame() {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) { alert('Failed to create room'); return; }
  const data = await res.json();

  state.roomId = data.roomId;

  document.getElementById('lobby-room-code').textContent = data.roomId;
  document.getElementById('qr-image').src = data.qrDataUrl;
  document.getElementById('join-url-display').value = data.joinUrl;

  showScreen('screen-lobby');

  connectWS(() => {
    sendWS('join', { roomId: data.roomId, playerName: 'Player 1' });
  });
}

/* ===== JOIN GAME (GUEST) ===== */
function joinGame(roomId, playerName) {
  state.roomId = roomId.toUpperCase();
  connectWS(() => {
    sendWS('join', { roomId: state.roomId, playerName: playerName || 'Player 2' });
  });
}

/* ===== ESCAPE HTML ===== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== WIRE UP BUTTONS ===== */
document.getElementById('btn-create').addEventListener('click', createGame);

document.getElementById('btn-join-manual').addEventListener('click', () => {
  const code = document.getElementById('input-room-code').value.trim();
  const name = document.getElementById('input-join-name').value.trim();
  if (!code) { alert('Enter a room code'); return; }
  joinGame(code, name);
});

document.getElementById('btn-start').addEventListener('click', () => {
  sendWS('startGame', {});
});

document.getElementById('btn-call').addEventListener('click', () => {
  sendWS('callNumber', {});
});

document.getElementById('btn-copy-url').addEventListener('click', () => {
  const url = document.getElementById('join-url-display').value;
  navigator.clipboard.writeText(url).then(() => {
    document.getElementById('btn-copy-url').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('btn-copy-url').textContent = 'Copy'; }, 1500);
  });
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  sendWS('playAgain', {});
});

document.getElementById('btn-home').addEventListener('click', () => {
  location.href = '/';
});

document.getElementById('btn-confirm-join').addEventListener('click', () => {
  const name = document.getElementById('input-guest-name').value.trim();
  const code = document.getElementById('join-room-code-display').textContent.trim();
  document.getElementById('join-status').textContent = 'Connecting…';
  joinGame(code, name);
});

/* ===== HANDLE /join/:roomId route ===== */
(function checkJoinRoute() {
  const match = location.pathname.match(/^\/join\/([A-Za-z0-9]+)$/);
  if (match) {
    const roomId = match[1].toUpperCase();
    document.getElementById('join-room-code-display').textContent = roomId;
    showScreen('screen-join');
  }
})();
