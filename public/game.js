const socket = io();

const lobby = document.getElementById('lobby');
const waitingRoom = document.getElementById('waitingRoom');
const gameScreen = document.getElementById('gameScreen');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const lobbyMsg = document.getElementById('lobbyMsg');
const roomCodeEl = document.getElementById('roomCode');
const shareLink = document.getElementById('shareLink');
const playerCount = document.getElementById('playerCount');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const timerEl = document.getElementById('timer');
const statsPanel = document.getElementById('statsPanel');
const upgradeOverlay = document.getElementById('upgradeOverlay');
const upgradeChoices = document.getElementById('upgradeChoices');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverStats = document.getElementById('gameOverStats');

let myId = null;
let latestState = null;
let roomStarted = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

socket.on('connect', () => { myId = socket.id; });

// --- Lobby flow ---
const params = new URLSearchParams(location.search);
const prefillRoom = params.get('room');
if (prefillRoom) roomInput.value = prefillRoom.toUpperCase();

document.getElementById('createBtn').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'นักรบไร้นาม';
  socket.emit('createRoom', name, (res) => {
    enterWaitingRoom(res.roomId);
  });
});

document.getElementById('joinBtn').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'นักรบไร้นาม';
  const code = roomInput.value.trim().toUpperCase();
  if (!code) { lobbyMsg.textContent = 'กรอกรหัสห้องก่อน'; return; }
  socket.emit('joinRoom', code, name, (res) => {
    if (res.error) { lobbyMsg.textContent = res.error; return; }
    enterWaitingRoom(res.roomId);
  });
});

function enterWaitingRoom(roomId) {
  lobby.classList.add('hidden');
  waitingRoom.classList.remove('hidden');
  roomCodeEl.textContent = roomId;
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  shareLink.value = url;
}

document.getElementById('copyBtn').addEventListener('click', () => {
  shareLink.select();
  navigator.clipboard.writeText(shareLink.value);
});

document.getElementById('startBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

// --- Game state updates ---
socket.on('state', (state) => {
  latestState = state;
  if (state.started && !roomStarted) {
    roomStarted = true;
    waitingRoom.classList.add('hidden');
    gameScreen.classList.remove('hidden');
  }
  playerCount.textContent = `ผู้เล่นในห้อง: ${state.players.length}`;
  if (roomStarted) updateHud(state);
  if (state.gameOver) showGameOver(state);
});

// --- Input handling ---
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
window.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in keys) keys[k] = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in keys) keys[k] = false;
});

let lastSentDx = null, lastSentDy = null;
setInterval(() => {
  if (!roomStarted) return;
  let dx = 0, dy = 0;
  if (keys.w || keys.ArrowUp) dy -= 1;
  if (keys.s || keys.ArrowDown) dy += 1;
  if (keys.a || keys.ArrowLeft) dx -= 1;
  if (keys.d || keys.ArrowRight) dx += 1;
  if (dx !== lastSentDx || dy !== lastSentDy) {
    lastSentDx = dx; lastSentDy = dy;
    socket.emit('input', { dx, dy });
  }
}, 50);

// --- Rendering ---
function worldToScreen(x, y, cam) {
  return { x: x - cam.x + canvas.width / 2, y: y - cam.y + canvas.height / 2 };
}

const ENEMY_COLORS = { wolf: '#8899aa', skeleton: '#d8d0b8', draugr: '#4a7a4a' };
const ENEMY_EMOJI = { wolf: '🐺', skeleton: '💀', draugr: '☠️' };

function render() {
  requestAnimationFrame(render);
  if (!latestState || !roomStarted) return;
  const me = latestState.players.find((p) => p.id === myId) || latestState.players[0];
  const cam = me ? { x: me.x, y: me.y } : { x: 1000, y: 1000 };

  ctx.fillStyle = '#101826';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // grid
  ctx.strokeStyle = 'rgba(74,85,120,0.25)';
  ctx.lineWidth = 1;
  const gridSize = 100;
  const offX = -(cam.x % gridSize);
  const offY = -(cam.y % gridSize);
  for (let x = offX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = offY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // orbs
  for (const o of latestState.orbs) {
    const s = worldToScreen(o.x, o.y, cam);
    ctx.fillStyle = '#3aa0d4';
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill();
  }

  // projectiles
  for (const pr of latestState.projectiles) {
    const s = worldToScreen(pr.x, pr.y, cam);
    ctx.fillStyle = '#d4af37';
    ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
  }

  // enemies
  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of latestState.enemies) {
    const s = worldToScreen(e.x, e.y, cam);
    ctx.font = e.elite ? '30px serif' : '22px serif';
    ctx.fillText(ENEMY_EMOJI[e.type] || '👹', s.x, s.y);
    const w = e.elite ? 50 : 26;
    const barY = e.elite ? -34 : -24;
    if (e.elite && e.name) {
      ctx.fillStyle = '#e06060';
      ctx.font = 'bold 14px Georgia';
      ctx.fillText(`☠ ${e.name} ☠`, s.x, s.y - 44);
    }
    ctx.fillStyle = '#402020';
    ctx.fillRect(s.x - w / 2, s.y + barY, w, 5);
    ctx.fillStyle = e.elite ? '#e06060' : '#c0392b';
    ctx.fillRect(s.x - w / 2, s.y + barY, w * Math.max(0, e.hp / e.maxHp), 5);
  }

  // players
  for (const p of latestState.players) {
    const s = worldToScreen(p.x, p.y, cam);
    ctx.font = '26px serif';
    ctx.globalAlpha = p.alive ? 1 : 0.3;
    ctx.fillText(p.id === myId ? '🛡️' : '🪓', s.x, s.y);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '13px Georgia';
    ctx.fillText(p.name, s.x, s.y - 26);
    const w = 34;
    ctx.fillStyle = '#402020';
    ctx.fillRect(s.x - w / 2, s.y + 16, w, 5);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(s.x - w / 2, s.y + 16, w * Math.max(0, p.hp / p.maxHp), 5);
  }
}
render();

function formatTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateHud(state) {
  timerEl.textContent = formatTime(state.elapsed);
  statsPanel.innerHTML = state.players.map((p) => `
    <div class="pstat">
      <strong>${p.name}${p.id === myId ? ' (คุณ)' : ''}</strong> — Lv.${p.level} ${p.alive ? '' : '💀'}
      <div class="bar"><div class="bar-fill" style="width:${Math.max(0, (p.hp / p.maxHp) * 100)}%"></div></div>
      <div class="bar"><div class="bar-fill xp-fill" style="width:${(p.xp / p.xpNeeded) * 100}%"></div></div>
    </div>
  `).join('');

  const me = state.players.find((p) => p.id === myId);
  if (me && me.pendingLevelUp) {
    upgradeOverlay.classList.remove('hidden');
    upgradeChoices.innerHTML = '';
    for (const u of me.pendingLevelUp) {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.textContent = u.label;
      card.addEventListener('click', () => {
        socket.emit('chooseUpgrade', u.id);
        upgradeOverlay.classList.add('hidden');
      });
      upgradeChoices.appendChild(card);
    }
  } else {
    upgradeOverlay.classList.add('hidden');
  }
}

function showGameOver(state) {
  upgradeOverlay.classList.add('hidden');
  if (!gameOverOverlay.classList.contains('hidden')) return;
  gameOverOverlay.classList.remove('hidden');
  gameOverStats.innerHTML = `รอดชีวิต ${formatTime(state.elapsed)}<br/>` +
    state.players.map((p) => `${p.name}: เลเวล ${p.level}, ฆ่า ${p.kills} ตัว`).join('<br/>');
}
