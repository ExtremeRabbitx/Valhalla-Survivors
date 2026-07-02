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

// --- Particles & juice ---
let particles = [];
let levelBursts = [];
const hitFlashes = new Map(); // enemyId -> timestamp
const playerFacing = new Map(); // playerId -> 1 (right) | -1 (left)
let shake = { time: 0, magnitude: 0 };
let damageFlash = 0;

// ambient embers drifting upward, screen-space (purely decorative)
const embers = Array.from({ length: 36 }, () => ({
  x: Math.random(),
  y: Math.random(),
  speed: 8 + Math.random() * 14,
  drift: (Math.random() - 0.5) * 6,
  size: 1 + Math.random() * 2,
  phase: Math.random() * Math.PI * 2,
}));

function spawnParticles(x, y, color, count, speed, life) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    particles.push({
      x, y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      life, maxLife: life,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function triggerShake(magnitude, time) {
  shake.magnitude = Math.max(shake.magnitude, magnitude);
  shake.time = Math.max(shake.time, time);
}

const ENEMY_PARTICLE_COLOR = { wolf: '#c0c8d8', skeleton: '#e8e0c8', draugr: '#7ada7a' };

// --- Game state updates ---
socket.on('state', (state) => {
  if (latestState) diffEffects(latestState, state);
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

function diffEffects(oldState, newState) {
  const oldEnemies = new Map(oldState.enemies.map((e) => [e.id, e]));
  const newIds = new Set(newState.enemies.map((e) => e.id));
  for (const [id, e] of oldEnemies) {
    if (!newIds.has(id)) {
      // enemy died
      spawnParticles(e.x, e.y, ENEMY_PARTICLE_COLOR[e.type] || '#c0392b', e.elite ? 22 : 10, e.elite ? 220 : 140, 0.5);
      hitFlashes.delete(id);
    }
  }
  for (const e of newState.enemies) {
    const old = oldEnemies.get(e.id);
    if (old && e.hp < old.hp) {
      hitFlashes.set(e.id, performance.now());
      spawnParticles(e.x, e.y, '#ffe08a', 3, 80, 0.25);
    }
  }
  const oldPlayers = new Map(oldState.players.map((p) => [p.id, p]));
  for (const p of newState.players) {
    const old = oldPlayers.get(p.id);
    if (old && p.hp < old.hp) {
      spawnParticles(p.x, p.y, '#e06060', 6, 100, 0.3);
      if (p.id === myId) {
        triggerShake(8, 0.25);
        damageFlash = 0.35;
      }
    }
    if (old && p.level > old.level) {
      levelBursts.push({ x: p.x, y: p.y, life: 0.6, maxLife: 0.6 });
      spawnParticles(p.x, p.y, '#f0d060', 18, 160, 0.6);
    }
    if (old && Math.abs(p.x - old.x) > 0.5) {
      playerFacing.set(p.id, p.x > old.x ? 1 : -1);
    }
  }
}

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
let lastMoveDir = { x: 0, y: -1 };
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
  if (dx !== 0 || dy !== 0) lastMoveDir = { x: dx, y: dy };
}, 50);

// --- Rendering ---
function worldToScreen(x, y, cam) {
  return { x: x - cam.x + canvas.width / 2, y: y - cam.y + canvas.height / 2 };
}

const ENEMY_EMOJI = { wolf: '🐺', skeleton: '💀', draugr: '☠️' };

let lastFrameTime = performance.now();

function updateParticles(dt) {
  particles = particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    return p.life > 0;
  });
  levelBursts = levelBursts.filter((b) => {
    b.life -= dt;
    return b.life > 0;
  });
}

function drawEmbers(dt) {
  ctx.save();
  for (const e of embers) {
    e.y -= (e.speed * dt) / canvas.height;
    e.x += (Math.sin(performance.now() / 1000 + e.phase) * e.drift * dt) / canvas.width;
    if (e.y < -0.02) { e.y = 1.02; e.x = Math.random(); }
    const x = e.x * canvas.width;
    const y = e.y * canvas.height;
    const alpha = 0.15 + 0.15 * Math.sin(performance.now() / 400 + e.phase);
    ctx.fillStyle = `rgba(212,175,55,${Math.max(0, alpha)})`;
    ctx.beginPath(); ctx.arc(x, y, e.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBackground(cam, t) {
  const bgGrad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, canvas.height
  );
  bgGrad.addColorStop(0, '#182238');
  bgGrad.addColorStop(0.6, '#0f1626');
  bgGrad.addColorStop(1, '#080b13');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(74,85,120,0.22)';
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

  // deterministic decorative runes scattered across the world
  const cell = 300;
  const startCol = Math.floor((cam.x - canvas.width / 2) / cell) - 1;
  const endCol = Math.floor((cam.x + canvas.width / 2) / cell) + 1;
  const startRow = Math.floor((cam.y - canvas.height / 2) / cell) - 1;
  const endRow = Math.floor((cam.y + canvas.height / 2) / cell) + 1;
  ctx.font = '20px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const runes = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᛗ', 'ᛟ'];
  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const hash = Math.abs(Math.sin(col * 127.1 + row * 311.7) * 43758.5453) % 1;
      if (hash < 0.35) {
        const wx = col * cell + ((hash * 997) % cell);
        const wy = row * cell + ((hash * 613) % cell);
        const s = worldToScreen(wx, wy, cam);
        const glow = 0.12 + 0.06 * Math.sin(t / 1000 + col + row);
        ctx.fillStyle = `rgba(212,175,55,${glow})`;
        ctx.fillText(runes[Math.floor(hash * runes.length * 999) % runes.length], s.x, s.y);
      }
    }
  }

  // vignette
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height / 3,
    canvas.width / 2, canvas.height / 2, canvas.height / 1.1
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function render() {
  requestAnimationFrame(render);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  updateParticles(dt);
  if (shake.time > 0) shake.time -= dt; else shake.magnitude = 0;
  if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 1.5);

  if (!latestState || !roomStarted) return;
  const me = latestState.players.find((p) => p.id === myId) || latestState.players[0];
  const shakeX = shake.time > 0 ? (Math.random() - 0.5) * shake.magnitude : 0;
  const shakeY = shake.time > 0 ? (Math.random() - 0.5) * shake.magnitude : 0;
  const cam = me ? { x: me.x - shakeX, y: me.y - shakeY } : { x: 1000, y: 1000 };

  drawBackground(cam, now);
  drawEmbers(dt);

  // warm light pooling under each living player
  for (const p of latestState.players) {
    if (!p.alive) continue;
    const s = worldToScreen(p.x, p.y, cam);
    const lightGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 140);
    lightGrad.addColorStop(0, 'rgba(212,175,55,0.12)');
    lightGrad.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.fillStyle = lightGrad;
    ctx.fillRect(s.x - 140, s.y - 140, 280, 280);
  }

  // orbs (pulsing glow)
  for (const o of latestState.orbs) {
    const s = worldToScreen(o.x, o.y, cam);
    const pulse = 1 + 0.25 * Math.sin(now / 150 + o.id);
    ctx.save();
    ctx.shadowColor = '#3aa0d4';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#5cc4f0';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // projectiles: spinning axes with a glowing trail
  for (const pr of latestState.projectiles) {
    const s = worldToScreen(pr.x, pr.y, cam);
    ctx.save();
    ctx.shadowColor = '#d4af37';
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240,208,96,0.4)'; ctx.fill();
    ctx.translate(s.x, s.y);
    ctx.rotate((now / 80 + (pr.id || 0)) % (Math.PI * 2));
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪓', 0, 0);
    ctx.restore();
  }

  // enemies
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of latestState.enemies) {
    const base = worldToScreen(e.x, e.y, cam);
    const bob = Math.sin(now / 180 + e.id) * 2.5;
    const s = { x: base.x, y: base.y + bob };
    const flashedAt = hitFlashes.get(e.id);
    const isFlashing = flashedAt && now - flashedAt < 120;

    if (e.elite) {
      const auraR = 26 + 4 * Math.sin(now / 200);
      ctx.save();
      ctx.strokeStyle = 'rgba(224,96,96,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, auraR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(224,96,96,0.3)';
      ctx.beginPath(); ctx.arc(s.x, s.y, auraR + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.font = e.elite ? '30px serif' : '22px serif';
    if (isFlashing) {
      ctx.save();
      ctx.filter = 'brightness(2.5)';
    }
    ctx.fillText(ENEMY_EMOJI[e.type] || '👹', s.x, s.y);
    if (isFlashing) ctx.restore();

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

  // particles (behind players, above enemies)
  for (const p of particles) {
    const s = worldToScreen(p.x, p.y, cam);
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // players
  ctx.font = '26px serif';
  for (const p of latestState.players) {
    const base = worldToScreen(p.x, p.y, cam);
    const bob = p.alive ? Math.sin(now / 160 + p.x * 0.01) * 2 : 0;
    const s = { x: base.x, y: base.y + bob };
    const facing = playerFacing.get(p.id) || 1;
    ctx.save();
    ctx.globalAlpha = p.alive ? 1 : 0.3;
    if (p.id === myId) {
      ctx.shadowColor = '#d4af37';
      ctx.shadowBlur = 12;
    }
    ctx.translate(s.x, s.y);
    ctx.scale(facing, 1);
    ctx.fillText(p.id === myId ? '🛡️' : '🪓', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '13px Georgia';
    ctx.fillText(p.name, s.x, s.y - 26);
    ctx.font = '26px serif';
    const w = 34;
    ctx.fillStyle = '#402020';
    ctx.fillRect(s.x - w / 2, s.y + 16, w, 5);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(s.x - w / 2, s.y + 16, w * Math.max(0, p.hp / p.maxHp), 5);
  }

  // level-up golden burst rings
  for (const b of levelBursts) {
    const s = worldToScreen(b.x, b.y, cam);
    const progress = 1 - b.life / b.maxLife;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = '#f0d060';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, 20 + progress * 60, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  if (damageFlash > 0) {
    ctx.fillStyle = `rgba(180,20,20,${damageFlash * 0.4})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    const signature = me.pendingLevelUp.map((u) => u.id).join(',');
    if (upgradeChoices.dataset.signature !== signature) {
      upgradeChoices.dataset.signature = signature;
      upgradeOverlay.classList.remove('hidden');
      upgradeChoices.innerHTML = '';
      for (const u of me.pendingLevelUp) {
        const card = document.createElement('div');
        card.className = 'upgrade-card';
        card.textContent = u.label;
        card.addEventListener('click', () => {
          socket.emit('chooseUpgrade', u.id);
          upgradeOverlay.classList.add('hidden');
          upgradeChoices.dataset.signature = '';
        });
        upgradeChoices.appendChild(card);
      }
    }
  } else {
    upgradeChoices.dataset.signature = '';
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
