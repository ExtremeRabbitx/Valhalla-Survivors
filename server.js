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
const NIGHT_CYCLE = 90; // seconds per full day/night cycle
const NIGHT_DURATION = 30; // last N seconds of each cycle are night
const MERCHANT_INTERVAL = 70;
const MERCHANT_DURATION = 20;
const MERCHANT_RADIUS = 80;
const ENDLESS_THRESHOLD = 900; // 15 minutes — scaling accelerates and a separate leaderboard applies
const BASH_RADIUS = 100;
const HEAL_RADIUS = 200;
const VOLLEY_COUNT = 10;
const MAX_ENEMIES = 180; // hard cap so long games don't slow to a crawl as enemy count balloons
const POWERUP_CHANCE = 0.06; // chance a regular kill drops a temporary power-up instead of nothing extra
const POWERUP_DURATION = 8; // seconds a speed/damage boost lasts
const POTION_HEAL = 30;

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

const CLASSES = {
  warrior: { hpMult: 1.25, dmgMult: 1, speedMult: 0.95, skill: 'bash', skillCooldownMax: 7000 },
  archer: { hpMult: 0.85, dmgMult: 1.05, speedMult: 1.1, skill: 'volley', skillCooldownMax: 6000 },
  mage: { hpMult: 0.9, dmgMult: 0.95, speedMult: 1, skill: 'heal', skillCooldownMax: 10000 },
};

const MODIFIERS = [
  { id: 'none', enemySpeedMult: 1, enemyHpMult: 1, xpMult: 1, dmgMult: 1, hpMult: 1, eliteChanceMult: 1, regenBonus: 0, goldMult: 1 },
  { id: 'swift_foes', enemySpeedMult: 1.2, enemyHpMult: 1, xpMult: 1.3, dmgMult: 1, hpMult: 1, eliteChanceMult: 1, regenBonus: 0, goldMult: 1 },
  { id: 'glass_cannon', enemySpeedMult: 1, enemyHpMult: 1, xpMult: 1, dmgMult: 1.25, hpMult: 0.8, eliteChanceMult: 1, regenBonus: 0, goldMult: 1 },
  { id: 'blood_moon', enemySpeedMult: 1, enemyHpMult: 1.15, xpMult: 1, dmgMult: 1, hpMult: 1, eliteChanceMult: 1, regenBonus: 0, goldMult: 2 },
  { id: 'fortune', enemySpeedMult: 1, enemyHpMult: 1.2, xpMult: 1, dmgMult: 1, hpMult: 1, eliteChanceMult: 1.6, regenBonus: 0, goldMult: 1 },
  { id: 'blessed_ground', enemySpeedMult: 1, enemyHpMult: 1, xpMult: 1, dmgMult: 1, hpMult: 1, eliteChanceMult: 1, regenBonus: 0.5, goldMult: 1 },
];

const MERCHANT_ITEMS = [
  { id: 'heal', cost: 20, apply: (p) => { p.hp = p.maxHp; } },
  { id: 'maxhp', cost: 25, apply: (p) => { p.maxHp += 20; p.hp += 20; } },
  { id: 'damage', cost: 30, apply: (p) => { p.damage += 6; } },
  { id: 'speed', cost: 20, apply: (p) => { p.speed += 25; } },
  { id: 'atkspeed', cost: 30, apply: (p) => { p.attackCooldownMax = Math.max(150, p.attackCooldownMax - 50); } },
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
    weaponChoice: 'hammer',
    weapon: 'hammer',
    classChoice: 'warrior',
    playerClass: 'warrior',
    relicCount: 0,
    gold: 0,
    skillCooldown: 0,
    skillCooldownMax: 7000,
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
    speedBoostUntil: 0,
    damageBoostUntil: 0,
  };
}

const rooms = new Map();

function broadcastLobby(room) {
  io.to(room.id).emit('lobbyUpdate', {
    players: [...room.players.values()].map((p) => ({ name: p.name, weaponChoice: p.weaponChoice, classChoice: p.classChoice })),
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
    merchant: null,
    started: false,
    gameOver: false,
    leaderboardRecorded: false,
    difficulty: 'normal',
    modifier: MODIFIERS[0],
    elapsed: 0,
    spawnTimer: 0,
    worldBossTimer: WORLD_BOSS_INTERVAL,
    worldBossAlive: false,
    eventTimer: EVENT_INTERVAL_MIN,
    merchantTimer: MERCHANT_INTERVAL,
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

// After ENDLESS_THRESHOLD, difficulty growth accelerates so the run never truly plateaus.
function effectiveMinute(room) {
  const minute = room.elapsed / 60;
  const endlessMinute = ENDLESS_THRESHOLD / 60;
  if (minute <= endlessMinute) return minute;
  return endlessMinute + (minute - endlessMinute) * 1.6;
}

function spawnEnemy(room, opts = {}) {
  const { forceWorldBoss, forceType, atPlayer } = opts;
  // World bosses are rare and important, so they always get through; regular spawns
  // (including swarm-event bursts) stop once the room is already crowded, which is
  // what kept long games slowing to a crawl as the enemy count kept climbing forever.
  if (!forceWorldBoss && room.enemies.length >= MAX_ENEMIES) return null;
  const angle = Math.random() * Math.PI * 2;
  const dist = 700 + Math.random() * 200;
  const players = [...room.players.values()].filter((p) => p.alive);
  if (players.length === 0) return null;
  const target = atPlayer || players[Math.floor(Math.random() * players.length)];
  const x = Math.max(20, Math.min(WORLD_W - 20, target.x + Math.cos(angle) * dist));
  const y = Math.max(20, Math.min(WORLD_H - 20, target.y + Math.sin(angle) * dist));
  const minute = effectiveMinute(room);
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  const mod = room.modifier || MODIFIERS[0];
  // Co-op scaling: more players alive => enemies tankier so the fight stays a real fight,
  // but not linearly, so a duo isn't punished as hard as raw player-count math would suggest. Capped for larger groups.
  const coopScale = Math.min(2.6, 1 + 0.35 * (players.length - 1));
  const isElite = !forceWorldBoss && !forceType && Math.random() < Math.min(0.15, minute * 0.03) * mod.eliteChanceMult;
  const isWorldBoss = !!forceWorldBoss;
  const type = isWorldBoss ? 'worldboss' : (forceType || (isElite ? 'draugr' : pickEnemyType()));
  const eliteMult = isWorldBoss ? 16 : (isElite ? 4 : 1);
  const night = isNight(room);
  const hp = Math.round((15 + minute * 8) * coopScale * diff.hp * mod.enemyHpMult * eliteMult * (night ? 1.15 : 1));
  const speed = (60 + Math.random() * 20 + minute * 2) * (isElite || isWorldBoss ? 0.75 : 1) * mod.enemySpeedMult;
  const enemy = {
    id: room.nextEnemyId++,
    x, y, hp, maxHp: hp,
    speed,
    damage: Math.round((4 + minute * 1.5) * diff.damage * (isWorldBoss ? 3 : (isElite ? 2 : 1)) * (night ? 1.1 : 1)),
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

function isNight(room) {
  return (room.elapsed % NIGHT_CYCLE) >= (NIGHT_CYCLE - NIGHT_DURATION);
}

// --- Leaderboards (in-memory, best-effort persisted to disk) ---
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const ENDURANCE_FILE = path.join(__dirname, 'endurance.json');
let leaderboard = [];
let enduranceLeaderboard = [];
try { leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); } catch (e) { leaderboard = []; }
try { enduranceLeaderboard = JSON.parse(fs.readFileSync(ENDURANCE_FILE, 'utf8')); } catch (e) { enduranceLeaderboard = []; }

function recordLeaderboard(room) {
  for (const p of room.players.values()) {
    const entry = {
      name: p.name, elapsed: Math.round(room.elapsed), level: p.level,
      kills: p.kills, difficulty: room.difficulty, date: Date.now(),
    };
    leaderboard.push(entry);
    if (room.elapsed >= ENDLESS_THRESHOLD) enduranceLeaderboard.push({ ...entry });
  }
  leaderboard.sort((a, b) => b.elapsed - a.elapsed);
  leaderboard = leaderboard.slice(0, 10);
  enduranceLeaderboard.sort((a, b) => b.elapsed - a.elapsed);
  enduranceLeaderboard = enduranceLeaderboard.slice(0, 10);
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard)); } catch (e) { /* best effort */ }
  try { fs.writeFileSync(ENDURANCE_FILE, JSON.stringify(enduranceLeaderboard)); } catch (e) { /* best effort */ }
  io.emit('leaderboard', leaderboard);
  io.emit('enduranceLeaderboard', enduranceLeaderboard);
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

  const mod = room.modifier || MODIFIERS[0];

  // spawn waves — more players alive means enemies spawn faster (sqrt curve keeps duo play fair)
  const minute = effectiveMinute(room);
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

  // traveling merchant
  if (!room.merchant) {
    room.merchantTimer -= dt;
    if (room.merchantTimer <= 0) {
      room.merchantTimer = MERCHANT_INTERVAL;
      const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 80;
      const offers = [...MERCHANT_ITEMS].sort(() => Math.random() - 0.5).slice(0, 3).map((it) => ({ id: it.id, cost: it.cost }));
      room.merchant = {
        x: Math.max(40, Math.min(WORLD_W - 40, anchor.x + Math.cos(angle) * dist)),
        y: Math.max(40, Math.min(WORLD_H - 40, anchor.y + Math.sin(angle) * dist)),
        expires: MERCHANT_DURATION,
        offers,
      };
    }
  } else {
    room.merchant.expires -= dt;
    if (room.merchant.expires <= 0) room.merchant = null;
  }

  // move players
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = p.dx / len;
    const ny = p.dy / len;
    const speedNow = p.speed * (room.elapsed < p.speedBoostUntil ? 1.4 : 1);
    if (p.dx !== 0 || p.dy !== 0) {
      p.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_W - PLAYER_RADIUS, p.x + nx * speedNow * dt));
      p.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_H - PLAYER_RADIUS, p.y + ny * speedNow * dt));
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.skillCooldown > 0) p.skillCooldown -= TICK_MS;
    const regen = p.regen + mod.regenBonus;
    if (regen > 0) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
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
        const dmg = Math.round(p.damage * (p.synergyActive ? SYNERGY_DAMAGE_MULT : 1) * (room.elapsed < p.damageBoostUntil ? 1.3 : 1));
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

  // remove dead enemies -> spawn xp/gold orbs (+ exploders burst nearby players, world bosses drop a relic)
  const survivors = [];
  for (const e of room.enemies) {
    if (e.hp <= 0) {
      room.orbs.push({ id: room.nextOrbId++, x: e.x, y: e.y, value: Math.round((e.worldBoss ? 120 : (e.elite ? 25 : 8)) * mod.xpMult) });
      if (e.worldBoss) {
        room.orbs.push({ id: room.nextOrbId++, x: e.x + 14, y: e.y + 14, value: 0, relic: true });
      }
      const goldAmount = e.worldBoss ? 30 : (e.elite ? 10 : (Math.random() < 0.2 * mod.goldMult ? Math.round(3 * mod.goldMult) : 0));
      if (goldAmount > 0) {
        room.orbs.push({ id: room.nextOrbId++, x: e.x - 10, y: e.y + 10, value: 0, gold: goldAmount });
      }
      if (!e.elite && Math.random() < POWERUP_CHANCE) {
        const roll = Math.random();
        const power = roll < 0.5 ? 'potion' : (roll < 0.75 ? 'speedboost' : 'damageboost');
        room.orbs.push({ id: room.nextOrbId++, x: e.x + 10, y: e.y - 10, value: 0, power });
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
        if (orb.gold) {
          p.gold += orb.gold;
          return false;
        }
        if (orb.power) {
          if (orb.power === 'potion') p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
          else if (orb.power === 'speedboost') p.speedBoostUntil = room.elapsed + POWERUP_DURATION;
          else if (orb.power === 'damageboost') p.damageBoostUntil = room.elapsed + POWERUP_DURATION;
          io.to(p.id).emit('powerupPickup', orb.power);
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
    modifier: room.modifier ? room.modifier.id : 'none',
    night: isNight(room),
    endless: room.elapsed >= ENDLESS_THRESHOLD,
    elapsed: room.elapsed,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
      level: p.level, xp: p.xp, xpNeeded: xpForLevel(p.level), alive: p.alive,
      pendingLevelUp: p.pendingLevelUp, kills: p.kills, eliteKills: p.eliteKills, worldBossKills: p.worldBossKills,
      weapon: p.weapon, playerClass: p.playerClass, gold: p.gold,
      skillCooldown: p.skillCooldown, skillCooldownMax: p.skillCooldownMax,
      evolved: p.evolved, reviveProgress: p.reviveProgress, synergyActive: p.synergyActive,
      speedBoostActive: room.elapsed < p.speedBoostUntil, damageBoostActive: room.elapsed < p.damageBoostUntil,
    })),
    enemies: room.enemies.map((e) => ({
      id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, type: e.type, elite: e.elite, worldBoss: e.worldBoss, name: e.name,
    })),
    projectiles: room.projectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y, ownerId: pr.ownerId })),
    enemyProjectiles: room.enemyProjectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y })),
    orbs: room.orbs.map((o) => ({ id: o.id, x: o.x, y: o.y, relic: o.relic, gold: o.gold, power: o.power })),
    treasure: room.treasure ? { x: room.treasure.x, y: room.treasure.y, progress: room.treasure.progress, required: TREASURE_REQUIRED, timer: room.treasure.timer } : null,
    merchant: room.merchant ? { x: room.merchant.x, y: room.merchant.y, expires: room.merchant.expires, offers: room.merchant.offers } : null,
  };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.emit('leaderboard', leaderboard);
  socket.emit('enduranceLeaderboard', enduranceLeaderboard);

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

  socket.on('setClass', (classId) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.started) return;
    const p = room.players.get(socket.id);
    if (!p || !CLASSES[classId]) return;
    p.classChoice = classId;
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
      room.modifier = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
      for (const p of room.players.values()) {
        const w = WEAPONS[p.weaponChoice] || WEAPONS.hammer;
        p.weapon = p.weaponChoice;
        p.damage = Math.round(p.damage * w.dmg);
        p.attackCooldownMax = Math.round(p.attackCooldownMax / w.atkSpeed);
        p.attackRange = Math.round(p.attackRange * w.range);

        const c = CLASSES[p.classChoice] || CLASSES.warrior;
        p.playerClass = p.classChoice;
        p.damage = Math.round(p.damage * c.dmgMult);
        p.maxHp = Math.round(p.maxHp * c.hpMult);
        p.hp = p.maxHp;
        p.speed = Math.round(p.speed * c.speedMult);
        p.skillCooldownMax = c.skillCooldownMax;
        p.skillCooldown = 0;

        // relics are a light permanent-feeling bonus earned from past world-boss kills (client-tracked count)
        const relicMult = 1 + Math.min(0.3, p.relicCount * 0.01);
        p.damage = Math.round(p.damage * relicMult);
        p.maxHp = Math.round(p.maxHp * relicMult);
        p.hp = p.maxHp;
        p.speed = Math.round(p.speed * (1 + Math.min(0.15, p.relicCount * 0.005)));

        const mod = room.modifier;
        p.damage = Math.round(p.damage * mod.dmgMult);
        p.maxHp = Math.round(p.maxHp * mod.hpMult);
        p.hp = p.maxHp;
      }
      room.started = true;
      io.to(room.id).emit('runModifier', room.modifier.id);
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

  socket.on('useSkill', () => {
    const room = rooms.get(currentRoomId);
    if (!room || !room.started || room.gameOver) return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive || p.skillCooldown > 0) return;
    const c = CLASSES[p.playerClass] || CLASSES.warrior;
    p.skillCooldown = p.skillCooldownMax;

    if (c.skill === 'bash') {
      for (const e of room.enemies) {
        if (distance(p.x, p.y, e.x, e.y) < BASH_RADIUS) {
          e.hp -= p.damage * 2.5;
        }
      }
      io.to(room.id).emit('skillEffect', { type: 'bash', x: p.x, y: p.y, radius: BASH_RADIUS });
    } else if (c.skill === 'volley') {
      for (let i = 0; i < VOLLEY_COUNT; i++) {
        const a = (Math.PI * 2 * i) / VOLLEY_COUNT;
        room.projectiles.push({
          id: room.nextProjId++,
          x: p.x, y: p.y,
          vx: Math.cos(a) * 460, vy: Math.sin(a) * 460,
          damage: p.damage, pierce: p.piercing, ownerId: p.id, life: 1,
        });
      }
      io.to(room.id).emit('skillEffect', { type: 'volley', x: p.x, y: p.y });
    } else if (c.skill === 'heal') {
      const healAmount = Math.round(p.maxHp * 0.3);
      for (const ally of room.players.values()) {
        if (ally.alive && distance(ally.x, ally.y, p.x, p.y) < HEAL_RADIUS) {
          ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
        }
      }
      io.to(room.id).emit('skillEffect', { type: 'heal', x: p.x, y: p.y, radius: HEAL_RADIUS });
    }
  });

  socket.on('buyItem', (offerIndex) => {
    const room = rooms.get(currentRoomId);
    if (!room || !room.merchant) return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive) return;
    if (distance(p.x, p.y, room.merchant.x, room.merchant.y) > MERCHANT_RADIUS) return;
    const offer = room.merchant.offers[offerIndex];
    if (!offer || p.gold < offer.cost) return;
    const item = MERCHANT_ITEMS.find((it) => it.id === offer.id);
    if (!item) return;
    p.gold -= offer.cost;
    item.apply(p);
    room.merchant.offers[offerIndex] = null;
    io.to(p.id).emit('purchaseOk', offer.id);
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
