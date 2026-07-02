const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TICK_MS = 50; // 20 ticks/sec
const WORLD_W = 2000;
const WORLD_H = 2000;
const XP_ORB_RADIUS = 8;
const PLAYER_RADIUS = 16;
const ENEMY_RADIUS = 14;

const UPGRADES = [
  { id: 'damage', label: '⚔️ เพิ่มดาเมจ', apply: (p) => { p.damage += 4; } },
  { id: 'atkspeed', label: '⚡ โจมตีเร็วขึ้น', apply: (p) => { p.attackCooldownMax = Math.max(150, p.attackCooldownMax - 60); } },
  { id: 'speed', label: '👟 เคลื่อนไหวขึ้น', apply: (p) => { p.speed += 30; } },
  { id: 'hp', label: '❤️ เลือดสูงสุดเพิ่ม', apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  { id: 'range', label: '🏹 ระยะโจมไกลขึ้น', apply: (p) => { p.attackRange += 40; } },
  { id: 'multishot', label: '🌀 ยิงหลายทิศทาง', apply: (p) => { p.projectileCount += 1; } },
  { id: 'regen', label: '🌿 ฟื้นฟูเลือด', apply: (p) => { p.regen += 0.5; } },
  { id: 'magnet', label: '🧲 ดูดพลังไกลขึ้น', apply: (p) => { p.pickupRadius += 35; } },
];

function randomUpgrades() {
  const shuffled = [...UPGRADES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((u) => ({ id: u.id, label: u.label }));
}

function xpForLevel(level) {
  return 20 + level * 15;
}

function makePlayer(id, name) {
  return {
    id,
    name,
    x: WORLD_W / 2 + (Math.random() * 100 - 50),
    y: WORLD_H / 2 + (Math.random() * 100 - 50),
    dx: 0,
    dy: 0,
    hp: 100,
    maxHp: 100,
    regen: 0,
    speed: 180,
    damage: 10,
    attackRange: 220,
    attackCooldown: 0,
    attackCooldownMax: 500,
    projectileCount: 1,
    pickupRadius: 40,
    xp: 0,
    level: 1,
    alive: true,
    invuln: 0,
    pendingLevelUp: null,
    kills: 0,
  };
}

const rooms = new Map();

function createRoom() {
  const id = Math.random().toString(36).substring(2, 7).toUpperCase();
  const room = {
    id,
    players: new Map(),
    enemies: [],
    projectiles: [],
    orbs: [],
    started: false,
    gameOver: false,
    elapsed: 0,
    spawnTimer: 0,
    nextEnemyId: 1,
    nextProjId: 1,
    nextOrbId: 1,
  };
  rooms.set(id, room);
  return room;
}

function spawnEnemy(room) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 700 + Math.random() * 200;
  const players = [...room.players.values()].filter((p) => p.alive);
  if (players.length === 0) return;
  const target = players[Math.floor(Math.random() * players.length)];
  const x = Math.max(20, Math.min(WORLD_W - 20, target.x + Math.cos(angle) * dist));
  const y = Math.max(20, Math.min(WORLD_H - 20, target.y + Math.sin(angle) * dist));
  const minute = room.elapsed / 60;
  // Co-op scaling: more players alive => enemies tankier so the fight stays a real fight,
  // but not linearly, so a duo isn't punished as hard as raw player-count math would suggest.
  const coopScale = 1 + 0.35 * (players.length - 1);
  const isElite = Math.random() < Math.min(0.15, minute * 0.03);
  const hp = Math.round((15 + minute * 8) * coopScale * (isElite ? 4 : 1));
  const speed = (60 + Math.random() * 20 + minute * 2) * (isElite ? 0.8 : 1);
  room.enemies.push({
    id: room.nextEnemyId++,
    x, y, hp, maxHp: hp,
    speed,
    damage: Math.round((4 + minute * 1.5) * (isElite ? 2 : 1)),
    elite: isElite,
    name: isElite ? nextBossName() : null,
    type: isElite ? 'draugr' : (Math.random() < 0.5 ? 'wolf' : 'skeleton'),
  });
}

const BOSS_NAMES = ['ShennyS', 'POND', 'POOMPAE', 'RIPRY'];
let bossNamePool = [];
function nextBossName() {
  if (bossNamePool.length === 0) bossNamePool = [...BOSS_NAMES].sort(() => Math.random() - 0.5);
  return bossNamePool.pop();
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function tickRoom(room) {
  if (!room.started || room.gameOver) return;
  const dt = TICK_MS / 1000;
  room.elapsed += dt;

  const alivePlayers = [...room.players.values()].filter((p) => p.alive);
  if (alivePlayers.length === 0) {
    room.gameOver = true;
    return;
  }

  // spawn waves — more players alive means enemies spawn faster (sqrt curve keeps duo play fair)
  const minute = room.elapsed / 60;
  const baseInterval = Math.max(0.4, 1.8 - minute * 0.14);
  const spawnInterval = baseInterval / Math.sqrt(alivePlayers.length);
  room.spawnTimer += dt;
  while (room.spawnTimer >= spawnInterval) {
    room.spawnTimer -= spawnInterval;
    spawnEnemy(room);
  }

  // move players
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = p.dx / len;
    const ny = p.dy / len;
    if (p.dx !== 0 || p.dy !== 0) {
      p.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_W - PLAYER_RADIUS, p.x + nx * p.speed * dt));
      p.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_H - PLAYER_RADIUS, p.y + ny * p.speed * dt));
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
  }

  // move enemies toward nearest player
  for (const e of room.enemies) {
    let nearest = null;
    let best = Infinity;
    for (const p of alivePlayers) {
      const d = distance(e.x, e.y, p.x, p.y);
      if (d < best) { best = d; nearest = p; }
    }
    if (nearest) {
      const dx = nearest.x - e.x;
      const dy = nearest.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.x += (dx / len) * e.speed * dt;
      e.y += (dy / len) * e.speed * dt;
      if (best < PLAYER_RADIUS + ENEMY_RADIUS && nearest.invuln <= 0) {
        nearest.hp -= e.damage;
        nearest.invuln = 0.6;
        if (nearest.hp <= 0) {
          nearest.hp = 0;
          nearest.alive = false;
        }
      }
    }
  }

  // player attacks
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    p.attackCooldown -= TICK_MS;
    if (p.attackCooldown <= 0) {
      let targets = room.enemies
        .map((e) => ({ e, d: distance(p.x, p.y, e.x, e.y) }))
        .filter((t) => t.d <= p.attackRange)
        .sort((a, b) => a.d - b.d)
        .slice(0, p.projectileCount);
      if (targets.length > 0) {
        p.attackCooldown = p.attackCooldownMax;
        for (const t of targets) {
          const dx = t.e.x - p.x;
          const dy = t.e.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          room.projectiles.push({
            id: room.nextProjId++,
            x: p.x, y: p.y,
            vx: (dx / len) * 500,
            vy: (dy / len) * 500,
            damage: p.damage,
            ownerId: p.id,
            life: 1.2,
          });
        }
      }
    }
  }

  // move projectiles & collide
  room.projectiles = room.projectiles.filter((pr) => {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.life <= 0) return false;
    for (const e of room.enemies) {
      if (distance(pr.x, pr.y, e.x, e.y) < ENEMY_RADIUS + 6) {
        e.hp -= pr.damage;
        return false;
      }
    }
    return true;
  });

  // remove dead enemies -> spawn xp orbs
  const survivors = [];
  for (const e of room.enemies) {
    if (e.hp <= 0) {
      room.orbs.push({ id: room.nextOrbId++, x: e.x, y: e.y, value: e.elite ? 25 : 8 });
      const owner = alivePlayers[0];
      if (owner) owner.kills += 1;
    } else {
      survivors.push(e);
    }
  }
  room.enemies = survivors;

  // orb magnet pull + pickup
  for (const orb of room.orbs) {
    for (const p of alivePlayers) {
      if (p.pendingLevelUp) continue;
      const d = distance(orb.x, orb.y, p.x, p.y);
      const pullRange = PLAYER_RADIUS + XP_ORB_RADIUS + p.pickupRadius;
      if (d < pullRange && d > 1) {
        const pull = 260 * dt;
        orb.x += ((p.x - orb.x) / d) * pull;
        orb.y += ((p.y - orb.y) / d) * pull;
      }
    }
  }
  room.orbs = room.orbs.filter((orb) => {
    for (const p of alivePlayers) {
      if (!p.pendingLevelUp && distance(orb.x, orb.y, p.x, p.y) < PLAYER_RADIUS + XP_ORB_RADIUS + p.pickupRadius) {
        p.xp += orb.value;
        const needed = xpForLevel(p.level);
        if (p.xp >= needed) {
          p.xp -= needed;
          p.level += 1;
          p.pendingLevelUp = randomUpgrades();
        }
        return false;
      }
    }
    return true;
  });
}

function serializeRoom(room) {
  return {
    id: room.id,
    started: room.started,
    gameOver: room.gameOver,
    elapsed: room.elapsed,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
      level: p.level, xp: p.xp, xpNeeded: xpForLevel(p.level), alive: p.alive,
      pendingLevelUp: p.pendingLevelUp, kills: p.kills,
    })),
    enemies: room.enemies.map((e) => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, type: e.type, elite: e.elite, name: e.name })),
    projectiles: room.projectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y })),
    orbs: room.orbs.map((o) => ({ id: o.id, x: o.x, y: o.y })),
  };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('createRoom', (name, cb) => {
    const room = createRoom();
    currentRoomId = room.id;
    socket.join(room.id);
    room.players.set(socket.id, makePlayer(socket.id, name || 'Player'));
    cb({ roomId: room.id });
  });

  socket.on('joinRoom', (roomId, name, cb) => {
    const room = rooms.get((roomId || '').toUpperCase());
    if (!room) { cb({ error: 'ไม่พบห้องนี้' }); return; }
    if (room.started) { cb({ error: 'เกมเริ่มไปแล้ว' }); return; }
    currentRoomId = room.id;
    socket.join(room.id);
    room.players.set(socket.id, makePlayer(socket.id, name || 'Player'));
    cb({ roomId: room.id });
  });

  socket.on('startGame', () => {
    const room = rooms.get(currentRoomId);
    if (room) room.started = true;
  });

  socket.on('input', ({ dx, dy }) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) { p.dx = dx; p.dy = dy; }
  });

  socket.on('chooseUpgrade', (upgradeId) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p || !p.pendingLevelUp) return;
    const choice = UPGRADES.find((u) => u.id === upgradeId);
    if (choice) choice.apply(p);
    p.pendingLevelUp = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomId);
    if (room) {
      room.players.delete(socket.id);
      if (room.players.size === 0) {
        rooms.delete(room.id);
      }
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
    io.to(room.id).emit('state', serializeRoom(room));
  }
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Valhalla Survivors listening on :${PORT}`));
