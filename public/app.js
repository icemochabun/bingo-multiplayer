/* ===================================================
   MULTIPLAYER BINGO — PeerJS (fully static, no server)
   Host = game authority. Guest connects via WebRTC.
   =================================================== */

/* ===== BINGO HELPERS ===== */

function generateBingoCard() {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  // Generate 5 unique numbers per column first, then build rows
  const cols = ranges.map(([min, max]) => {
    const pool = [];
    while (pool.length < 5) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!pool.includes(n)) pool.push(n);
    }
    return pool;
  });
  const grid = Array.from({ length: 5 }, (_, row) => cols.map(col => col[row]));
  grid[2][2] = 0; // FREE
  return grid;
}

function makeRoomCode() {
  // Short 6-char code that doubles as the PeerJS peer ID
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateCallBag() {
  const nums = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

function checkBingo(marked) {
  for (let r = 0; r < 5; r++) if (marked[r].every(v => v)) return true;
  for (let c = 0; c < 5; c++) if (marked.every(row => row[c])) return true;
  if ([0,1,2,3,4].every(i => marked[i][i])) return true;
  if ([0,1,2,3,4].every(i => marked[i][4-i])) return true;
  return false;
}

function bingoLetter(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function freshMarked() {
  const m = Array.from({ length: 5 }, () => Array(5).fill(false));
  m[2][2] = true;
  return m;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ===== GAME STATE ===== */
const G = {
  peer: null,
  isHost: false,
  myName: '',
  myCard: null,
  myMarked: null,
  calledNumbers: [],
  currentNumber: null,
  status: 'idle',   // idle | waiting | playing | finished
  players: [],      // [{id, name}]
  winner: null,

  // Host only
  guestConn: null,
  guestCard: null,
  guestMarked: null,
  callBag: [],
  guestName: 'Player 2',
};

/* ===== SCREEN MANAGEMENT ===== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ===== PEER MESSAGING ===== */
function sendToGuest(type, payload) {
  if (G.guestConn && G.guestConn.open) {
    G.guestConn.send({ type, payload });
  }
}

function sendToHost(type, payload) {
  if (G.peer && G.guestConn && G.guestConn.open) {
    G.guestConn.send({ type, payload }); // G.guestConn is the host conn for guest
  }
}

/* ===== HOST: HANDLE MESSAGES FROM GUEST ===== */
function handleGuestMessage({ type, payload }) {
  if (type === 'hello') {
    G.guestName = payload.name || 'Player 2';
    G.players = [
      { id: 'host', name: G.myName },
      { id: 'guest', name: G.guestName },
    ];

    // Send guest their card + current state
    sendToGuest('welcome', {
      card: G.guestCard,
      marked: G.guestMarked,
      players: G.players,
      calledNumbers: G.calledNumbers,
      currentNumber: G.currentNumber,
      status: G.status,
    });

    // Update host UI
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-start').textContent = 'Start Game!';
    renderPlayers(G.players);
    renderVsBadge(G.players);

    showNotification('Player 2 joined! Start when ready.');
  }

  else if (type === 'markCell') {
    const { row, col } = payload;
    const val = G.guestCard[row][col];
    if (val !== 0 && !G.calledNumbers.includes(val)) return; // not called yet
    if (G.guestMarked[row][col]) return; // already marked

    G.guestMarked[row][col] = true;
    sendToGuest('cellMarked', { row, col, marked: G.guestMarked });

    if (checkBingo(G.guestMarked)) {
      endGame('guest');
    }
  }
}

/* ===== GUEST: HANDLE MESSAGES FROM HOST ===== */
function handleHostMessage({ type, payload }) {
  if (type === 'welcome') {
    G.myCard = payload.card;
    G.myMarked = payload.marked;
    G.players = payload.players;
    G.calledNumbers = payload.calledNumbers || [];
    G.currentNumber = payload.currentNumber;
    G.status = payload.status;

    showScreen('screen-game');
    document.getElementById('game-room-code').textContent =
      document.getElementById('join-room-code-display').textContent;
    renderCard();
    renderCalledNumbers();
    showCurrentNumber(G.currentNumber);
    renderVsBadge(G.players);
    updateGameUI();
  }

  else if (type === 'gameStarted') {
    G.status = 'playing';
    document.getElementById('waiting-overlay').classList.add('hidden');
    updateGameUI();
    renderCard();
  }

  else if (type === 'numberCalled') {
    G.calledNumbers = payload.calledNumbers;
    G.currentNumber = payload.number;
    showCurrentNumber(payload.number);
    renderCalledNumbers();
    renderCard();
  }

  else if (type === 'cellMarked') {
    G.myMarked = payload.marked;
    renderCard();
  }

  else if (type === 'bingo') {
    G.status = 'finished';
    const isWinner = payload.winnerId === 'guest';
    showWinnerOverlay(payload.winnerName, isWinner);
  }

  else if (type === 'newGame') {
    G.myCard = payload.card;
    G.myMarked = payload.marked;
    G.calledNumbers = [];
    G.currentNumber = null;
    G.status = 'waiting';
    G.winner = null;

    document.getElementById('winner-overlay').classList.add('hidden');
    showCurrentNumber(null);
    renderCalledNumbers();
    renderCard();
    updateGameUI();
    document.getElementById('waiting-overlay').classList.remove('hidden');
    document.getElementById('waiting-text').textContent = 'Waiting for host to start…';
  }

  else if (type === 'hostLeft') {
    showNotification('Host disconnected.');
    document.getElementById('game-status-label').textContent = 'Host disconnected';
  }
}

/* ===== HOST: END GAME ===== */
function endGame(winnerId) {
  G.status = 'finished';
  G.winner = winnerId;
  const winnerName = winnerId === 'host' ? G.myName : G.guestName;

  sendToGuest('bingo', { winnerId, winnerName });
  showWinnerOverlay(winnerName, winnerId === 'host');
}

/* ===== CREATE GAME (HOST) ===== */
async function createGame() {
  G.isHost = true;
  G.myName = 'Player 1';
  G.myCard = generateBingoCard();
  G.myMarked = freshMarked();
  G.guestCard = generateBingoCard();
  G.guestMarked = freshMarked();
  G.callBag = generateCallBag();
  G.calledNumbers = [];
  G.currentNumber = null;
  G.status = 'waiting';
  G.players = [{ id: 'host', name: G.myName }];

  document.getElementById('btn-create').disabled = true;
  document.getElementById('btn-create').textContent = 'Creating…';

  const roomCode = makeRoomCode();
  G.peer = new Peer(roomCode, { debug: 0 });

  G.peer.on('open', async (id) => {
    const joinUrl = `${location.origin}${location.pathname}?join=${id}`;
    document.getElementById('lobby-room-code').textContent = id.toUpperCase();
    document.getElementById('join-url-display').value = joinUrl;

    document.getElementById('qr-image').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`;

    renderPlayers(G.players);
    showScreen('screen-lobby');
  });

  G.peer.on('connection', (conn) => {
    if (G.guestConn) {
      conn.on('open', () => conn.send({ type: 'error', payload: { message: 'Room is full' } }));
      return;
    }
    G.guestConn = conn;
    conn.on('data', handleGuestMessage);
    conn.on('close', () => {
      G.guestConn = null;
      if (G.status === 'playing') {
        G.status = 'waiting';
        showNotification('Guest disconnected');
      }
    });
  });

  G.peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Collision on short code — retry silently
      G.peer.destroy();
      G.peer = null;
      createGame();
      return;
    }
    alert('Connection error: ' + (err.message || err.type) + '\nMake sure you are online.');
    document.getElementById('btn-create').disabled = false;
    document.getElementById('btn-create').textContent = 'Create Game';
  });
}

/* ===== JOIN GAME (GUEST) ===== */
function joinGame(hostPeerId, myName) {
  G.isHost = false;
  G.myName = myName || 'Player 2';

  document.getElementById('btn-confirm-join').disabled = true;
  document.getElementById('join-status').textContent = 'Connecting…';

  G.peer = new Peer(undefined, { debug: 0 });

  G.peer.on('open', () => {
    const conn = G.peer.connect(hostPeerId, { reliable: true });
    G.guestConn = conn; // reuse field; for guest it's the conn to host

    conn.on('open', () => {
      conn.send({ type: 'hello', payload: { name: G.myName } });
      document.getElementById('join-status').textContent = 'Waiting for host…';
    });

    conn.on('data', handleHostMessage);

    conn.on('close', () => {
      handleHostMessage({ type: 'hostLeft', payload: {} });
    });

    conn.on('error', (err) => {
      document.getElementById('join-status').textContent = 'Connection failed: ' + err.message;
      document.getElementById('btn-confirm-join').disabled = false;
    });
  });

  G.peer.on('error', (err) => {
    document.getElementById('join-status').textContent = 'Error: ' + err.message;
    document.getElementById('btn-confirm-join').disabled = false;
  });
}

/* ===== UI RENDERERS ===== */

function renderCard() {
  const grid = document.getElementById('bingo-card');
  grid.innerHTML = '';
  if (!G.myCard) return;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const val = G.myCard[row][col];
      const isMarked = G.myMarked[row][col];
      const isFree = val === 0;
      const isCalled = G.calledNumbers.includes(val);

      const cell = document.createElement('div');
      cell.className = 'bingo-cell';

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

      if (!isMarked && !isFree && G.status === 'playing') {
        cell.addEventListener('click', () => onCellClick(row, col));
      }

      grid.appendChild(cell);
    }
  }
}

function renderCalledNumbers() {
  const container = document.getElementById('called-numbers-grid');
  container.innerHTML = '';
  G.calledNumbers.forEach((n, i) => {
    const chip = document.createElement('div');
    chip.className = 'called-chip';
    if (i === G.calledNumbers.length - 1) chip.classList.add('latest');
    chip.textContent = n;
    container.appendChild(chip);
  });
}

function showCurrentNumber(n) {
  document.getElementById('num-letter').textContent = n ? bingoLetter(n) : '-';
  document.getElementById('num-value').textContent = n ?? '--';
}

function renderPlayers(players) {
  const list = document.getElementById('lobby-players');
  if (!list) return;
  list.innerHTML = '';
  players.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'player-item';
    const badge = i === 0
      ? '<span class="badge badge-host">Host</span>'
      : '<span class="badge badge-guest">Guest</span>';
    item.innerHTML = `<span class="player-name">${escapeHtml(p.name)}</span>${badge}`;
    list.appendChild(item);
  });
}

function renderVsBadge(players) {
  const badge = document.getElementById('vs-badge');
  if (players && players.length >= 2) {
    badge.textContent = `${escapeHtml(players[0].name)} vs ${escapeHtml(players[1].name)}`;
  }
}

function updateGameUI() {
  const callBtn = document.getElementById('btn-call');
  if (callBtn) {
    callBtn.style.display = (G.isHost && G.status === 'playing') ? 'block' : 'none';
  }

  const waitingOverlay = document.getElementById('waiting-overlay');
  if (G.status === 'waiting' && !G.isHost) {
    waitingOverlay.classList.remove('hidden');
    document.getElementById('waiting-text').textContent = 'Waiting for host to start…';
  } else if (G.status === 'playing') {
    waitingOverlay.classList.add('hidden');
  }

  const label = document.getElementById('game-status-label');
  if (label) {
    const map = { waiting: 'Waiting to start…', playing: 'Game in progress', finished: 'Game over' };
    label.textContent = map[G.status] || '';
  }
}

function showWinnerOverlay(winnerName, isMe) {
  const overlay = document.getElementById('winner-overlay');
  document.getElementById('winner-text').textContent = isMe ? 'BINGO! You win! 🎉' : `${escapeHtml(winnerName)} got BINGO!`;
  overlay.classList.remove('hidden');
  document.getElementById('btn-play-again').style.display = G.isHost ? 'block' : 'none';
}

function showNotification(msg) {
  const label = document.getElementById('game-status-label');
  if (label) label.textContent = msg;
}

/* ===== ACTIONS ===== */

function onCellClick(row, col) {
  if (G.status !== 'playing') return;

  if (G.isHost) {
    const val = G.myCard[row][col];
    if (val !== 0 && !G.calledNumbers.includes(val)) return;
    if (G.myMarked[row][col]) return;
    G.myMarked[row][col] = true;
    renderCard();
    if (checkBingo(G.myMarked)) endGame('host');
  } else {
    sendToHost('markCell', { row, col });
  }
}

function callNextNumber() {
  if (!G.isHost || G.status !== 'playing' || G.callBag.length === 0) return;
  const num = G.callBag.pop();
  G.currentNumber = num;
  G.calledNumbers.push(num);
  showCurrentNumber(num);
  renderCalledNumbers();
  renderCard();
  sendToGuest('numberCalled', { number: num, calledNumbers: G.calledNumbers });
}

function startGame() {
  if (!G.isHost || !G.guestConn) return;
  G.status = 'playing';
  sendToGuest('gameStarted', { status: 'playing' });
  showScreen('screen-game');
  document.getElementById('game-room-code').textContent =
    document.getElementById('lobby-room-code').textContent;
  G.players = [{ id: 'host', name: G.myName }, { id: 'guest', name: G.guestName }];
  renderVsBadge(G.players);
  renderCard();
  renderCalledNumbers();
  showCurrentNumber(null);
  updateGameUI();
}

function playAgain() {
  G.myCard = generateBingoCard();
  G.myMarked = freshMarked();
  G.guestCard = generateBingoCard();
  G.guestMarked = freshMarked();
  G.callBag = generateCallBag();
  G.calledNumbers = [];
  G.currentNumber = null;
  G.status = 'waiting';
  G.winner = null;

  sendToGuest('newGame', {
    card: G.guestCard,
    marked: G.guestMarked,
  });

  document.getElementById('winner-overlay').classList.add('hidden');
  showCurrentNumber(null);
  renderCalledNumbers();
  renderCard();
  updateGameUI();
}

/* ===== BUTTON WIRING ===== */

document.getElementById('btn-create').addEventListener('click', createGame);

document.getElementById('btn-join-manual').addEventListener('click', () => {
  const code = document.getElementById('input-room-code').value.trim().toLowerCase();
  const name = document.getElementById('input-join-name').value.trim();
  if (!code) { alert('Enter a room code'); return; }
  joinGame(code, name);
});

document.getElementById('btn-start').addEventListener('click', startGame);

document.getElementById('btn-call').addEventListener('click', callNextNumber);

document.getElementById('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('join-url-display').value)
    .then(() => {
      const btn = document.getElementById('btn-copy-url');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
});

document.getElementById('btn-play-again').addEventListener('click', playAgain);

document.getElementById('btn-home').addEventListener('click', () => {
  location.href = location.origin + location.pathname;
});

document.getElementById('btn-confirm-join').addEventListener('click', () => {
  const name = document.getElementById('input-guest-name').value.trim();
  const peerId = document.getElementById('join-room-code-display').textContent.trim();
  joinGame(peerId, name);
});

/* ===== AUTO-JOIN FROM URL ===== */
(function checkJoinRoute() {
  const params = new URLSearchParams(location.search);
  const peerId = params.get('join');
  if (peerId) {
    document.getElementById('join-room-code-display').textContent = peerId;
    showScreen('screen-join');
  }
})();
