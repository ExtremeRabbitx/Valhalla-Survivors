const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

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
const WORLD_BOSS_INTERVAL = 100; // seconds between guaranteed world bosses
const REVIVE_RADIUS = 60;
const REVIVE_TIME = 5; // seconds an ally must stand near a downed player
const SYNERGY_RADIUS = 150;
const SYNERGY_DAMAGE_MULT = 1.1;
const EVENT_INTERVAL_MIN = 100;
const EVENT_INTERVAL_MAX = 140;
const TREASURE_RADIUS = 60;
const TREASURE_REQUIRED = 6; // seconds of channeling to claim
const TREASURE_TIMEOUT = 22; // seconds before it disappears unclaimed
const EVOLVE_DAMAGE_UPGRADES = 5; // times 'damage' must be picked to evolve a weapon

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

const DIFFICULTY = {
  easy: { hp: 0.7, damage: 0.65, spawn: 0.8 },
  normal: { hp: 1, damage: 1, spawn: 1 },
  hard: { hp: 1.45, damage: 1.35, spawn: 1.3 },
};

const WEAPONS = {
  hammer: { dmg: 1, atkSpeed: 1, range: 1 },
  axe: { dmg: 0.7, atkSpeed: 1.5, range: 0.85 },
  sword: { dmg: 0.85, atkSpeed: 1, range: 1.35 },
};

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
    weaponChoice: 'hammer',
    weapon: 'hammer',
    relicCount: 0,
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
    eliteKills: 0,
    worldBossKills: 0,
    upgradeCounts: {},
    evolved: false,
    piercing: 0,
    reviveProgress: 0,
    synergyActive: false,
  };
}

const rooms = new Map();

function broadcastLobby(room) {
  io.to(room.id).emit('lobbyUpdate', {
    players: [...room.players.values()].map((p) => ({ name: p.name, weaponChoice: p.weaponChoice })),
  });
}

function createRoom() {
  const id = Math.random().toString(36).substring(2, 7).toUpperCase();
  const room = {
    id,
    players: new Map(),
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    orbs: [],
    treasure: null,
    started: false,
    gameOver: false,
    leaderboardRecorded: false,
    difficulty: 'normal',
    elapsed: 0,
    spawnTimer: 0,
    worldBossTimer: WORLD_BOSS_INTERVAL,
    worldBossAlive: false,
    eventTimer: EVENT_INTERVAL_MIN,
    nextEnemyId: 1,
    nextProjId: 1,
    nextOrbId: 1,
  };
  rooms.set(id, room);
  return room;
}

const NON_ELITE_TYPES = [
  { type: 'wolf', weight: 0.4 },
  { type: 'skeleton', weight: 0.35 },
  { type: 'caster', weight: 0.15 },
  { type: 'exploder', weight: 0.1 },
];
function pickEnemyType() {
  const r = Math.random();
  let acc = 0;
  for (const e of NON_ELITE_TYPES) {
    acc += e.weight;
    if (r < acc) return e.type;
  }
  return 'wolf';
}

function spawnEnemy(room, opts = {}) {
  const { forceWorldBoss, forceType, atPlayer } = opts;
  const angle = Math.random() * Math.PI * 2;
  const dist = 700 + Math.random() * 200;
  const players = [...room.players.values()].filter((p) => p.alive);
  if (players.length === 0) return null;
  const target = atPlayer || players[Math.floor(Math.random() * players.length)];
  const x = Math.max(20, Math.min(WORLD_W - 20, target.x + Math.cos(angle) * dist));
  const y = Math.max(20, Math.min(WORLD_H - 20, target.y + Math.sin(angle) * dist));
  const minute = room.elapsed / 60;
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  // Co-op scaling: more players alive => enemies tankier so the fight stays a real fight,
  // but not linearly, so a duo isn't punished as hard as raw player-count math would suggest. Capped for larger groups.
  const coopScale = Math.min(2.6, 1 + 0.35 * (players.length - 1));
  const isElite = !forceWorldBoss && !forceType && Math.random() < Math.min(0.15, minute * 0.03);
  const isWorldBoss = !!forceWorldBoss;
  const type = isWorldBoss ? 'worldboss' : (forceType || (isElite ? 'draugr' : pickEnemyType()));
  const eliteMult = isWorldBoss ? 16 : (isElite ? 4 : 1);
  const hp = Math.round((15 + minute * 8) * coopScale * diff.hp * eliteMult);
  const speed = (60 + Math.random() * 20 + minute * 2) * (isElite || isWorldBoss ? 0.75 : 1);
  const enemy = {
    id: room.nextEnemyId++,
    x, y, hp, maxHp: hp,
    speed,
    damage: Math.round((4 + minute * 1.5) * diff.damage * (isWorldBoss ? 3 : (isElite ? 2 : 1))),
    elite: isElite || isWorldBoss,
    worldBoss: isWorldBoss,
    name: (isElite || isWorldBoss) ? nextBossName(isWorldBoss) : null,
    type,
    attackCooldown: 0,
  };
  room.enemies.push(enemy);
  if (isWorldBoss) room.worldBossAlive = true;
  return enemy;
}

const BOSS_NAMES = ['ShennyS', 'POND', 'POOMPAE', 'RIPRY'];
const WORLD_BOSS_NAMES = ['Fenrir', 'Jörmungandr', 'Surtr', 'Hel'];
let bossNamePool = [];
function nextBossName(isWorldBoss) {
  if (isWorldBoss) return WORLD_BOSS_NAMES[Math.floor(Math.random() * WORLD_BOSS_NAMES.length)];
  if (bossNamePool.length === 0) bossNamePool = [...BOSS_NAMES].sort(() => Math.random() - 0.5);
  return bossNamePool.pop();
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// --- Leaderboard (in-memory, best-effort persisted to disk) ---
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
let leaderboard = [];
try {
  leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
} catch (e) { leaderboard = []; }

function recordLeaderboard(room) {
  for (const p of room.players.values()) {
    leaderboard.push({
      name: p.name, elapsed: Math.round(room.elapsed), level: p.level,
      kills: p.kills, difficulty: room.difficulty, date: Date.now(),
    });
  }
  leaderboard.sort((a, b) => b.elapsed - a.elapsed);
  leaderboard = leaderboard.slice(0, 10);
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard)); } catch (e) { /* best effort */ }
  io.emit('leaderboard', leaderboard);
}

function triggerWorldEvent(room, alivePlayers) {
  const kind = Math.random() < 0.5 ? 'swarm' : 'treasure';
  if (kind === 'swarm') {
    const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const swarmType = Math.random() < 0.5 ? 'wolf' : 'skeleton';
    for (let i = 0; i < 14; i++) {
      spawnEnemy(room, { forceType: swarmType, atPlayer: anchor });
    }
  } else if (!room.treasure) {
    const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 100;
    room.treasure = {
      x: Math.max(40, Math.min(WORLD_W - 40, anchor.x + Math.cos(angle) * dist)),
      y: Math.max(40, Math.min(WORLD_H - 40, anchor.y + Math.sin(angle) * dist)),
      progress: 0,
      timer: TREASURE_TIMEOUT,
    };
    // a few guards spawn around the treasure to make claiming it a real fight
    for (let i = 0; i < 4; i++) {
      spawnEnemy(room, { forceType: 'wolf', atPlayer: { x: room.treasure.x, y: room.treasure.y } });
    }
  }
}

function tickRoom(room) {
  if (!room.started || room.gameOver) return;
  const dt = TICK_MS / 1000;
  room.elapsed += dt;

  const alivePlayers = [...room.players.values()].filter((p) => p.alive);
  if (alivePlayers.length === 0) {
    room.gameOver = true;
    if (!room.leaderboardRecorded) {
      room.leaderboardRecorded = true;
      recordLeaderboard(room);
    }
    return;
  }

  // spawn waves — more players alive means enemies spawn faster (sqrt curve keeps duo play fair)
  const minute = room.elapsed / 60;
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  const baseInterval = Math.max(0.4, 1.8 - minute * 0.14) / diff.spawn;
  const spawnInterval = baseInterval / Math.sqrt(alivePlayers.length);
  room.spawnTimer += dt;
  while (room.spawnTimer >= spawnInterval) {
    room.spawnTimer -= spawnInterval;
    spawnEnemy(room);
  }

  // world boss timer
  if (!room.worldBossAlive) {
    room.worldBossTimer -= dt;
    if (room.worldBossTimer <= 0) {
      room.worldBossTimer = WORLD_BOSS_INTERVAL;
      spawnEnemy(room, { forceWorldBoss: true });
    }
  }

  // special world events (wolf swarm / treasure to defend)
  room.eventTimer -= dt;
  if (room.eventTimer <= 0) {
    room.eventTimer = EVENT_INTERVAL_MIN + Math.random() * (EVENT_INTERVAL_MAX - EVENT_INTERVAL_MIN);
    triggerWorldEvent(room, alivePlayers);
  }

  // treasure channel progress
  if (room.treasure) {
    const tr = room.treasure;
    tr.timer -= dt;
    const defenders = alivePlayers.filter((p) => distance(p.x, p.y, tr.x, tr.y) < TREASURE_RADIUS);
    if (defenders.length > 0) tr.progress += dt;
    if (tr.progress >= TREASURE_REQUIRED) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        room.orbs.push({ id: room.nextOrbId++, x: tr.x + Math.cos(a) * 20, y: tr.y + Math.sin(a) * 20, value: 15 });
      }
      room.treasure = null;
    } else if (tr.timer <= 0) {
      room.treasure = null;
    }
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

  // ally synergy: standing near another living ally grants a damage buff to both
  for (const p of alivePlayers) {
    p.synergyActive = alivePlayers.some((ally) => ally !== p && distance(ally.x, ally.y, p.x, p.y) < SYNERGY_RADIUS);
  }

  // revive downed teammates by standing near them
  for (const p of room.players.values()) {
    if (p.alive) continue;
    const beingRevived = alivePlayers.some((ally) => distance(ally.x, ally.y, p.x, p.y) < REVIVE_RADIUS);
    if (beingRevived) {
      p.reviveProgress += dt;
      if (p.reviveProgress >= REVIVE_TIME) {
        p.alive = true;
        p.hp = Math.round(p.maxHp * 0.5);
        p.invuln = 1.5;
        p.reviveProgress = 0;
      }
    } else {
      p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.5);
    }
  }

  // move enemies toward nearest player (casters keep their distance and shoot instead of meleeing)
  for (const e of room.enemies) {
    let nearest = null;
    let best = Infinity;
    for (const p of alivePlayers) {
      const d = distance(e.x, e.y, p.x, p.y);
      if (d < best) { best = d; nearest = p; }
    }
    if (!nearest) continue;
    const dx = nearest.x - e.x;
    const dy = nearest.y - e.y;
    const len = Math.hypot(dx, dy) || 1;

    if (e.type === 'caster') {
      const preferredRange = 190;
      if (best > preferredRange + 20) {
        e.x += (dx / len) * e.speed * dt;
        e.y += (dy / len) * e.speed * dt;
      } else if (best < preferredRange - 20) {
        e.x -= (dx / len) * e.speed * dt * 0.6;
        e.y -= (dy / len) * e.speed * dt * 0.6;
      }
      e.attackCooldown -= TICK_MS;
      if (e.attackCooldown <= 0 && best <= preferredRange + 40) {
        e.attackCooldown = 2200;
        room.enemyProjectiles.push({
          id: room.nextProjId++,
          x: e.x, y: e.y,
          vx: (dx / len) * 220, vy: (dy / len) * 220,
          damage: e.damage, life: 2.5,
        });
      }
      continue;
    }

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

  // enemy projectiles vs players
  room.enemyProjectiles = room.enemyProjectiles.filter((pr) => {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.life <= 0) return false;
    for (const p of alivePlayers) {
      if (p.invuln <= 0 && distance(pr.x, pr.y, p.x, p.y) < PLAYER_RADIUS + 6) {
        p.hp -= pr.damage;
        p.invuln = 0.4;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
        return false;
      }
    }
    return true;
  });

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
        const dmg = Math.round(p.damage * (p.synergyActive ? SYNERGY_DAMAGE_MULT : 1));
        for (const t of targets) {
          const dx = t.e.x - p.x;
          const dy = t.e.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          room.projectiles.push({
            id: room.nextProjId++,
            x: p.x, y: p.y,
            vx: (dx / len) * 500,
            vy: (dy / len) * 500,
            damage: dmg,
            pierce: p.piercing,
            ownerId: p.id,
            life: 1.2,
          });
        }
      }
    }
  }

  // move projectiles & collide (piercing projectiles from evolved weapons punch through multiple enemies)
  room.projectiles = room.projectiles.filter((pr) => {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.life <= 0) return false;
    for (const e of room.enemies) {
      if (distance(pr.x, pr.y, e.x, e.y) < ENEMY_RADIUS + 6) {
        e.hp -= pr.damage;
        if (pr.pierce > 0) { pr.pierce -= 1; continue; }
        return false;
      }
    }
    return true;
  });

  // remove dead enemies -> spawn xp orbs (+ exploders burst nearby players, world bosses drop a relic)
  const survivors = [];
  for (const e of room.enemies) {
    if (e.hp <= 0) {
      room.orbs.push({ id: room.nextOrbId++, x: e.x, y: e.y, value: e.worldBoss ? 120 : (e.elite ? 25 : 8) });
      if (e.worldBoss) {
        room.orbs.push({ id: room.nextOrbId++, x: e.x + 14, y: e.y + 14, value: 0, relic: true });
      }
      const owner = alivePlayers[0];
      if (owner) {
        owner.kills += 1;
        if (e.elite) owner.eliteKills += 1;
        if (e.worldBoss) owner.worldBossKills += 1;
      }
      if (e.type === 'exploder') {
        const burstDmg = Math.round(15 * (DIFFICULTY[room.difficulty] || DIFFICULTY.normal).damage);
        for (const p of alivePlayers) {
          if (distance(e.x, e.y, p.x, p.y) < 90) {
            p.hp -= burstDmg;
            if (p.hp <= 0) { p.hp = 0; p.alive = false; }
          }
        }
      }
      if (e.worldBoss) room.worldBossAlive = false;
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
      if (p.pendingLevelUp) continue;
      if (distance(orb.x, orb.y, p.x, p.y) < PLAYER_RADIUS + XP_ORB_RADIUS + p.pickupRadius) {
        if (orb.relic) {
          p.relicCount += 1;
          io.to(p.id).emit('relicPickup', p.relicCount);
          return false;
        }
        p.xp += orb.value;
        let needed = xpForLevel(p.level);
        while (p.xp >= needed) {
          p.xp -= needed;
          p.level += 1;
          p.pendingLevelUp = randomUpgrades();
          needed = xpForLevel(p.level);
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
    difficulty: room.difficulty,
    elapsed: room.elapsed,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
      level: p.level, xp: p.xp, xpNeeded: xpForLevel(p.level), alive: p.alive,
      pendingLevelUp: p.pendingLevelUp, kills: p.kills, eliteKills: p.eliteKills, worldBossKills: p.worldBossKills, weapon: p.weapon,
      evolved: p.evolved, reviveProgress: p.reviveProgress, synergyActive: p.synergyActive,
    })),
    enemies: room.enemies.map((e) => ({
      id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, type: e.type, elite: e.elite, worldBoss: e.worldBoss, name: e.name,
    })),
    projectiles: room.projectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y, ownerId: pr.ownerId })),
    enemyProjectiles: room.enemyProjectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y })),
    orbs: room.orbs.map((o) => ({ id: o.id, x: o.x, y: o.y, relic: o.relic })),
    treasure: room.treasure ? { x: room.treasure.x, y: room.treasure.y, progress: room.treasure.progress, required: TREASURE_REQUIRED, timer: room.treasure.timer } : null,
  };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.emit('leaderboard', leaderboard);

  // A socket must only ever be in one game room at a time — leave whatever
  // room it was previously in (e.g. from an earlier createRoom/joinRoom on
  // the same connection) so it doesn't keep receiving stale state broadcasts.
  function leaveCurrentRoom() {
    if (!currentRoomId) return;
    const prevRoom = rooms.get(currentRoomId);
    if (prevRoom) {
      prevRoom.players.delete(socket.id);
      socket.leave(currentRoomId);
      if (prevRoom.players.size === 0) {
        rooms.delete(prevRoom.id);
      } else {
        broadcastLobby(prevRoom);
      }
    }
    currentRoomId = null;
  }

  socket.on('createRoom', (name, cb) => {
    leaveCurrentRoom();
    const room = createRoom();
    currentRoomId = room.id;
    socket.join(room.id);
    room.players.set(socket.id, makePlayer(socket.id, name || 'Player'));
    cb({ roomId: room.id });
    broadcastLobby(room);
  });

  socket.on('joinRoom', (roomId, name, cb) => {
    const room = rooms.get((roomId || '').toUpperCase());
    if (!room) { cb({ error: 'roomNotFound' }); return; }
    if (room.started) { cb({ error: 'alreadyStarted' }); return; }
    leaveCurrentRoom();
    currentRoomId = room.id;
    socket.join(room.id);
    room.players.set(socket.id, makePlayer(socket.id, name || 'Player'));
    cb({ roomId: room.id });
    broadcastLobby(room);
  });

  socket.on('setWeapon', (weaponId) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.started) return;
    const p = room.players.get(socket.id);
    if (!p || !WEAPONS[weaponId]) return;
    p.weaponChoice = weaponId;
    broadcastLobby(room);
  });

  socket.on('setRelics', (count) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.started) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.relicCount = Math.max(0, Math.min(50, Math.floor(count) || 0));
  });

  socket.on('startGame', (difficulty) => {
    const room = rooms.get(currentRoomId);
    if (room) {
      room.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
      for (const p of room.players.values()) {
        const w = WEAPONS[p.weaponChoice] || WEAPONS.hammer;
        p.weapon = p.weaponChoice;
        p.damage = Math.round(p.damage * w.dmg);
        p.attackCooldownMax = Math.round(p.attackCooldownMax / w.atkSpeed);
        p.attackRange = Math.round(p.attackRange * w.range);
        // relics are a light permanent-feeling bonus earned from past world-boss kills (client-tracked count)
        const relicMult = 1 + Math.min(0.3, p.relicCount * 0.01);
        p.damage = Math.round(p.damage * relicMult);
        p.maxHp = Math.round(p.maxHp * relicMult);
        p.hp = p.maxHp;
        p.speed = Math.round(p.speed * (1 + Math.min(0.15, p.relicCount * 0.005)));
      }
      room.started = true;
    }
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
    if (choice) {
      choice.apply(p);
      p.upgradeCounts[upgradeId] = (p.upgradeCounts[upgradeId] || 0) + 1;
      if (!p.evolved && upgradeId === 'damage' && p.upgradeCounts.damage >= EVOLVE_DAMAGE_UPGRADES) {
        p.evolved = true;
        p.damage = Math.round(p.damage * 1.4);
        p.piercing = 2;
        io.to(p.id).emit('weaponEvolved');
      }
    }
    p.pendingLevelUp = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomId);
    if (room) {
      room.players.delete(socket.id);
      if (room.players.size === 0) {
        rooms.delete(room.id);
      } else {
        broadcastLobby(room);
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
