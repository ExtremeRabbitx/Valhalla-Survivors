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
const SLAM_COOLDOWN = 7; // seconds between world boss ground slams
const SLAM_TELEGRAPH_TIME = 1.2; // seconds of warning before the slam actually lands
const SLAM_RADIUS = 140;
const NECRO_SUMMON_COOLDOWN = 6000; // ms between a necromancer summoning a minion

// World boss signature attacks — a second attack per boss, on top of the shared slam, so the
// 4 world bosses stop being reskins of each other.
const SECOND_ATTACK_COOLDOWN = 9; // seconds between a boss's signature move
const LUNGE_TELEGRAPH_TIME = 0.9; // Fenrir: warning before it teleports to the target and hits
const LUNGE_RADIUS = 112;
const LUNGE_SPEED_BOOST = 2.5; // seconds of bonus movement speed after a Fenrir lunge lands
const SURTR_FAN_COUNT = 5;
const HEL_SUMMON_COUNT = 3;

// Ground hazard zones (fire/ice/poison patches) — shared by Jörmungandr's poison pool and the
// night-time fire/ice patches below, since both are "damage anyone standing in this circle".
const NIGHT_HAZARD_INTERVAL = 10; // seconds between new night patches (only ticks during night)
const NIGHT_HAZARD_RADIUS = 80;
const NIGHT_HAZARD_DURATION = 15;
const NIGHT_HAZARD_FIRE_DPS = 9;
const NIGHT_HAZARD_ICE_DPS = 3;
const POISON_POOL_DURATION = 6;
const POISON_POOL_DPS = 10;

// Evolved-weapon signature procs — on top of the shared evolve bonus (+40% dmg, pierce+2)
const AXE_BLEED_DURATION = 2;
const AXE_BLEED_DMG_FRACTION = 0.25; // bleed dps = weapon damage * this
const SWORD_CLEAVE_RADIUS = 55;
const SWORD_CLEAVE_FRACTION = 0.3; // cleave damage = hit damage * this
const HAMMER_STAGGER_DURATION = 0.6; // reuses the same slow field frost nova uses

// Kill-streak frenzy — rewards continuous killing, hard-resets if the player stops killing,
// so standing still/AFK-farming loses the buff fast instead of being free.
const FRENZY_MAX_STACKS = 6;
const FRENZY_DECAY_WINDOW = 3; // seconds without a kill before all stacks are lost
const FRENZY_DAMAGE_PER_STACK = 0.06;
const FRENZY_ATKSPEED_PER_STACK = 0.05;
const FRENZY_ATKSPEED_CAP = 0.3;

// Interactive altar — periodically activates at the world center; players must channel nearby
// to trigger a random room-wide blessing or curse. Mirrors the treasure-channel pattern.
const ALTAR_INTERVAL = 90;
const ALTAR_INITIAL_DELAY = 45;
const ALTAR_RADIUS = 70;
const ALTAR_CHANNEL_TIME = 4;
const ALTAR_ACTIVE_TIMEOUT = 20;
const ALTAR_BLESSING_CHANCE = 0.55;
const ALTAR_BLESSINGS = ['heal_all', 'shield_all', 'gold_boon', 'xp_boon'];
const ALTAR_CURSES = ['damage_all', 'spawn_ambush', 'gold_drain'];

const UPGRADES = [
  { id: 'damage', label: '⚔️ เพิ่มดาเมจ', apply: (p) => { p.damage += 4; } },
  { id: 'atkspeed', label: '⚡ โจมตีเร็วขึ้น', apply: (p) => { p.attackCooldownMax = Math.max(150, p.attackCooldownMax - 60); } },
  { id: 'speed', label: '👟 เคลื่อนไหวขึ้น', apply: (p) => { p.speed += 30; } },
  { id: 'hp', label: '❤️ เลือดสูงสุดเพิ่ม', apply: (p) => { p.maxHp += 25; p.hp += 25; } },
  { id: 'range', label: '🏹 ระยะโจมไกลขึ้น', apply: (p) => { p.attackRange += 40; } },
  { id: 'multishot', label: '🌀 ยิงหลายทิศทาง', apply: (p) => { p.projectileCount += 1; } },
  { id: 'regen', label: '🌿 ฟื้นฟูเลือด', apply: (p) => { p.regen += 0.5; } },
  { id: 'magnet', label: '🧲 ดูดพลังไกลขึ้น', apply: (p) => { p.pickupRadius += 35; } },
  { id: 'lightning', label: '⚡ พลังสายฟ้า', apply: (p) => { p.lightningLevel = (p.lightningLevel || 0) + 1; } },
  { id: 'fireaura', label: '🔥 วงแหวนไฟ', apply: (p) => { p.fireAuraLevel = (p.fireAuraLevel || 0) + 1; } },
  { id: 'frostnova', label: '❄️ คลื่นน้ำแข็ง', apply: (p) => { p.frostNovaLevel = (p.frostNovaLevel || 0) + 1; } },
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
  { id: 'blessed_ground', enemySpeedMult: 1, enemyHpMult: 1.12, xpMult: 1, dmgMult: 1, hpMult: 1, eliteChanceMult: 1, regenBonus: 0.5, goldMult: 1 },
];

const MERCHANT_ITEMS = [
  { id: 'heal', cost: 20, apply: (p) => { p.hp = p.maxHp; } },
  { id: 'maxhp', cost: 25, apply: (p) => { p.maxHp += 20; p.hp += 20; } },
  { id: 'damage', cost: 30, apply: (p) => { p.damage += 6; } },
  { id: 'speed', cost: 20, apply: (p) => { p.speed += 25; } },
  { id: 'atkspeed', cost: 30, apply: (p) => { p.attackCooldownMax = Math.max(150, p.attackCooldownMax - 50); } },
  { id: 'regen', cost: 25, apply: (p) => { p.regen += 0.4; } },
  { id: 'range', cost: 20, apply: (p) => { p.attackRange += 30; } },
  { id: 'magnet', cost: 15, apply: (p) => { p.pickupRadius += 25; } },
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
    killsByType: {},
    weaponDamageDealt: 0,
    skillDamageDealt: 0,
    upgradeCounts: {},
    evolved: false,
    piercing: 0,
    reviveProgress: 0,
    synergyActive: false,
    speedBoostUntil: 0,
    damageBoostUntil: 0,
    lightningLevel: 0,
    lightningCooldown: 0,
    fireAuraLevel: 0,
    frostNovaLevel: 0,
    frostNovaCooldown: 0,
    frenzyStacks: 0,
    frenzyDecayAt: 0,
    hazardSlowUntil: 0,
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
    hazards: [],
    hazardTimer: NIGHT_HAZARD_INTERVAL,
    altarActive: null,
    altarTimer: ALTAR_INITIAL_DELAY,
    nextEnemyId: 1,
    nextProjId: 1,
    nextOrbId: 1,
    nextHazardId: 1,
  };
  rooms.set(id, room);
  return room;
}

const NON_ELITE_TYPES = [
  { type: 'wolf', weight: 0.37 },
  { type: 'skeleton', weight: 0.32 },
  { type: 'caster', weight: 0.14 },
  { type: 'exploder', weight: 0.09 },
  { type: 'necromancer', weight: 0.08 },
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

// Distinct attack profiles per enemy type instead of one flat damage number for everything —
// wolves are fast but hit soft, skeletons hit hard and slow, exploders barely melee (their
// real damage is the death burst), casters/draugr/worldboss keep their existing multipliers.
const ENEMY_DAMAGE_MULT = { wolf: 0.75, skeleton: 1.3, caster: 0.9, exploder: 0.5, necromancer: 0.4, draugr: 1, worldboss: 1 };
const ENEMY_SPEED_MULT = { wolf: 1.15, skeleton: 0.9, caster: 1, exploder: 1, necromancer: 0.85, draugr: 1, worldboss: 1 };

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
  const speed = (60 + Math.random() * 20 + minute * 2) * (isElite || isWorldBoss ? 0.75 : 1) * mod.enemySpeedMult * (ENEMY_SPEED_MULT[type] || 1);
  const enemy = {
    id: room.nextEnemyId++,
    x, y, hp, maxHp: hp,
    speed,
    damage: Math.round((4 + minute * 1.5) * diff.damage * (isWorldBoss ? 3 : (isElite ? 2 : 1)) * (night ? 1.1 : 1) * (ENEMY_DAMAGE_MULT[type] || 1)),
    elite: isElite || isWorldBoss,
    worldBoss: isWorldBoss,
    name: (isElite || isWorldBoss) ? nextBossName(isWorldBoss) : null,
    type,
    attackCooldown: 0,
    summonCooldown: NECRO_SUMMON_COOLDOWN,
    slamCooldown: SLAM_COOLDOWN,
    slamTelegraph: null,
    // signature second attack (world boss only) — offset below full cooldown so it doesn't
    // always land right on top of the shared slam
    secondCooldown: SECOND_ATTACK_COOLDOWN * 0.6,
    lungeTelegraph: null,
    lungeSpeedBoostUntil: 0,
  };
  room.enemies.push(enemy);
  if (isWorldBoss) room.worldBossAlive = true;
  return enemy;
}

// A necromancer's summon is a weaker, un-targeted skeleton conjured right at its side —
// deliberately bypasses spawnEnemy's normal "spawn far away and walk in" placement.
function summonMinion(room, atX, atY) {
  if (room.enemies.length >= MAX_ENEMIES) return;
  const minute = effectiveMinute(room);
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  const mod = room.modifier || MODIFIERS[0];
  const angle = Math.random() * Math.PI * 2;
  const x = Math.max(20, Math.min(WORLD_W - 20, atX + Math.cos(angle) * 40));
  const y = Math.max(20, Math.min(WORLD_H - 20, atY + Math.sin(angle) * 40));
  const hp = Math.round((15 + minute * 8) * diff.hp * mod.enemyHpMult * 0.5);
  room.enemies.push({
    id: room.nextEnemyId++,
    x, y, hp, maxHp: hp,
    speed: (60 + Math.random() * 20 + minute * 2) * ENEMY_SPEED_MULT.skeleton,
    damage: Math.round((4 + minute * 1.5) * diff.damage * ENEMY_DAMAGE_MULT.skeleton * 0.6),
    elite: false,
    worldBoss: false,
    name: null,
    type: 'skeleton',
    attackCooldown: 0,
    summonCooldown: NECRO_SUMMON_COOLDOWN,
    slamCooldown: SLAM_COOLDOWN,
    slamTelegraph: null,
  });
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

// Resolves a completed altar channel into a random room-wide blessing or curse. Effects are
// one-shot (heal/damage/gold/spawn) rather than timed multipliers, so they're simple, safe,
// and don't need to be threaded through every damage formula in the game.
function triggerAltarEffect(room, alivePlayers, ax, ay) {
  const isBlessing = Math.random() < ALTAR_BLESSING_CHANCE;
  const pool = isBlessing ? ALTAR_BLESSINGS : ALTAR_CURSES;
  const kind = pool[Math.floor(Math.random() * pool.length)];
  switch (kind) {
    case 'heal_all':
      for (const p of alivePlayers) p.hp = p.maxHp;
      break;
    case 'shield_all':
      for (const p of alivePlayers) p.invuln = Math.max(p.invuln, 3);
      break;
    case 'gold_boon':
      for (const p of alivePlayers) p.gold += 40;
      break;
    case 'xp_boon':
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        room.orbs.push({ id: room.nextOrbId++, x: ax + Math.cos(a) * 30, y: ay + Math.sin(a) * 30, value: 20 });
      }
      break;
    case 'damage_all':
      for (const p of alivePlayers) p.hp = Math.max(1, p.hp - Math.round(p.maxHp * 0.15));
      break;
    case 'spawn_ambush':
      for (let i = 0; i < 6; i++) spawnEnemy(room, { forceType: 'wolf', atPlayer: { x: ax, y: ay } });
      break;
    case 'gold_drain':
      for (const p of alivePlayers) p.gold -= Math.floor(p.gold * 0.5);
      break;
  }
  io.to(room.id).emit('altarEffect', { kind, blessing: isBlessing });
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

  // interactive altar: periodically activates at the world center; players must channel nearby
  // to trigger a random room-wide blessing or curse (mirrors the treasure-channel pattern)
  const altarX = WORLD_W / 2, altarY = WORLD_H / 2;
  if (!room.altarActive) {
    room.altarTimer -= dt;
    if (room.altarTimer <= 0) {
      room.altarTimer = ALTAR_INTERVAL;
      room.altarActive = { progress: 0, timer: ALTAR_ACTIVE_TIMEOUT };
      // announce activation room-wide — the altar is only visible if you're already looking at
      // it, and it's live for a small fraction of the run, so without this players can easily
      // never notice it triggered at all
      io.to(room.id).emit('altarActivated');
    }
  } else {
    const a = room.altarActive;
    a.timer -= dt;
    const channelers = alivePlayers.filter((p) => distance(p.x, p.y, altarX, altarY) < ALTAR_RADIUS);
    if (channelers.length > 0) a.progress += dt;
    if (a.progress >= ALTAR_CHANNEL_TIME) {
      triggerAltarEffect(room, alivePlayers, altarX, altarY);
      room.altarActive = null;
    } else if (a.timer <= 0) {
      room.altarActive = null;
    }
  }

  // night ground hazards: fire/ice patches spawn only during the night phase, punishing
  // standing still — shares the hazards array/tick with Jörmungandr's poison pool above
  if (isNight(room)) {
    room.hazardTimer -= dt;
    if (room.hazardTimer <= 0) {
      room.hazardTimer = NIGHT_HAZARD_INTERVAL;
      const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 150 + Math.random() * 250;
      room.hazards.push({
        id: room.nextHazardId++,
        x: Math.max(40, Math.min(WORLD_W - 40, anchor.x + Math.cos(angle) * dist)),
        y: Math.max(40, Math.min(WORLD_H - 40, anchor.y + Math.sin(angle) * dist)),
        radius: NIGHT_HAZARD_RADIUS,
        kind: Math.random() < 0.5 ? 'fire' : 'ice',
        expiresAt: room.elapsed + NIGHT_HAZARD_DURATION,
      });
    }
  }
  room.hazards = room.hazards.filter((h) => {
    if (room.elapsed >= h.expiresAt) return false;
    const dps = h.kind === 'fire' ? NIGHT_HAZARD_FIRE_DPS : h.kind === 'ice' ? NIGHT_HAZARD_ICE_DPS : (h.dps || POISON_POOL_DPS);
    for (const p of alivePlayers) {
      if (distance(p.x, p.y, h.x, h.y) < h.radius) {
        p.hp -= dps * dt;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
        if (h.kind === 'ice') p.hazardSlowUntil = room.elapsed + 0.3;
      }
    }
    return true;
  });

  // move players
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = p.dx / len;
    const ny = p.dy / len;
    const speedNow = p.speed * (room.elapsed < p.speedBoostUntil ? 1.4 : 1) * (room.elapsed < p.hazardSlowUntil ? 0.5 : 1);
    if (p.dx !== 0 || p.dy !== 0) {
      p.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_W - PLAYER_RADIUS, p.x + nx * speedNow * dt));
      p.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_H - PLAYER_RADIUS, p.y + ny * speedNow * dt));
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.skillCooldown > 0) p.skillCooldown -= TICK_MS;
    const regen = p.regen + mod.regenBonus;
    if (regen > 0) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
    // frenzy hard-resets if the player goes too long without a kill — no free stacks from AFK-ing
    if (p.frenzyStacks > 0 && room.elapsed >= p.frenzyDecayAt) p.frenzyStacks = 0;
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

  // elemental powers: passive AoE abilities picked up as level-up upgrades, separate from
  // the player's main weapon attack (lightning bolts, a burning aura, a slowing frost pulse)
  for (const p of alivePlayers) {
    if (p.lightningLevel > 0) {
      p.lightningCooldown -= TICK_MS;
      if (p.lightningCooldown <= 0) {
        p.lightningCooldown = Math.max(800, 2600 - p.lightningLevel * 200);
        const targets = room.enemies
          .map((e) => ({ e, d: distance(p.x, p.y, e.x, e.y) }))
          .filter((t) => t.d < 320)
          .sort((a, b) => a.d - b.d)
          .slice(0, 1 + p.lightningLevel);
        if (targets.length > 0) {
          // per-bolt damage stays fixed at level up — only target count and cooldown scale with
          // level — so total output grows linearly, not quadratically, as levels stack
          const dmg = Math.round(p.damage * 0.5);
          for (const t of targets) { t.e.hp -= dmg; t.e.lastHitOwnerId = p.id; }
          p.skillDamageDealt += dmg * targets.length;
          io.to(room.id).emit('skillEffect', { type: 'lightning', x: p.x, y: p.y, targets: targets.map((t) => ({ x: t.e.x, y: t.e.y })) });
        }
      }
    }
    if (p.fireAuraLevel > 0) {
      const radius = 70 + p.fireAuraLevel * 15;
      // a flat baseline (so it's actually noticeable at low starting damage, ~10) plus a
      // damage-scaling term (so it doesn't fall behind once damage upgrades/relics/weapon stack
      // up late-game) — a damage-only version of this tried earlier came out to ~0.8 dps at
      // level 1 with base damage 10, which read as "does nothing" in real play
      const dps = (2 + p.fireAuraLevel * 1.5) + p.damage * (0.03 + p.fireAuraLevel * 0.02);
      for (const e of room.enemies) {
        if (distance(p.x, p.y, e.x, e.y) < radius) { e.hp -= dps * dt; e.lastHitOwnerId = p.id; p.skillDamageDealt += dps * dt; }
      }
    }
    if (p.frostNovaLevel > 0) {
      p.frostNovaCooldown -= TICK_MS;
      if (p.frostNovaCooldown <= 0) {
        p.frostNovaCooldown = Math.max(2000, 4500 - p.frostNovaLevel * 300);
        const radius = 120 + p.frostNovaLevel * 20;
        const dmg = Math.round(p.damage * 0.6 * p.frostNovaLevel);
        let hit = false;
        for (const e of room.enemies) {
          if (distance(p.x, p.y, e.x, e.y) < radius) {
            e.hp -= dmg;
            e.slowUntil = room.elapsed + 2.5;
            e.lastHitOwnerId = p.id;
            p.skillDamageDealt += dmg;
            hit = true;
          }
        }
        if (hit) io.to(room.id).emit('skillEffect', { type: 'frostnova', x: p.x, y: p.y, radius });
      }
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
    const slowMult = (e.slowUntil && room.elapsed < e.slowUntil) ? 0.4 : 1;
    const lungeBoost = (e.worldBoss && room.elapsed < e.lungeSpeedBoostUntil) ? 1.6 : 1;
    const eSpeed = e.speed * slowMult * lungeBoost;

    if (e.type === 'caster') {
      const preferredRange = 190;
      if (best > preferredRange + 20) {
        e.x += (dx / len) * eSpeed * dt;
        e.y += (dy / len) * eSpeed * dt;
      } else if (best < preferredRange - 20) {
        e.x -= (dx / len) * eSpeed * dt * 0.6;
        e.y -= (dy / len) * eSpeed * dt * 0.6;
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

    if (e.type === 'necromancer') {
      const preferredRange = 220;
      if (best > preferredRange + 20) {
        e.x += (dx / len) * eSpeed * dt;
        e.y += (dy / len) * eSpeed * dt;
      } else if (best < preferredRange - 20) {
        e.x -= (dx / len) * eSpeed * dt * 0.6;
        e.y -= (dy / len) * eSpeed * dt * 0.6;
      }
      e.summonCooldown -= TICK_MS;
      if (e.summonCooldown <= 0) {
        e.summonCooldown = NECRO_SUMMON_COOLDOWN;
        summonMinion(room, e.x, e.y);
      }
      continue;
    }

    if (e.worldBoss) {
      if (e.slamTelegraph) {
        if (room.elapsed >= e.slamTelegraph.triggerAt) {
          for (const p of alivePlayers) {
            if (distance(p.x, p.y, e.slamTelegraph.x, e.slamTelegraph.y) < e.slamTelegraph.radius) {
              p.hp -= e.damage * 1.8;
              if (p.hp <= 0) { p.hp = 0; p.alive = false; }
            }
          }
          // Jörmungandr's slam leaves a lingering poison pool instead of just a one-time hit
          if (e.name === 'Jörmungandr') {
            room.hazards.push({
              id: room.nextHazardId++, x: e.slamTelegraph.x, y: e.slamTelegraph.y,
              radius: e.slamTelegraph.radius, kind: 'poison', dps: POISON_POOL_DPS,
              expiresAt: room.elapsed + POISON_POOL_DURATION,
            });
          }
          e.slamTelegraph = null;
          e.slamCooldown = SLAM_COOLDOWN;
        }
      } else {
        e.slamCooldown -= dt;
        if (e.slamCooldown <= 0) {
          e.slamTelegraph = { x: e.x, y: e.y, radius: SLAM_RADIUS, triggerAt: room.elapsed + SLAM_TELEGRAPH_TIME };
        }
      }

      // signature second attack — distinct per boss, on its own cooldown separate from the slam
      if (e.lungeTelegraph) {
        if (room.elapsed >= e.lungeTelegraph.triggerAt) {
          e.x = e.lungeTelegraph.x;
          e.y = e.lungeTelegraph.y;
          for (const p of alivePlayers) {
            if (distance(p.x, p.y, e.x, e.y) < LUNGE_RADIUS) {
              p.hp -= e.damage * 1.4;
              if (p.hp <= 0) { p.hp = 0; p.alive = false; }
            }
          }
          e.lungeSpeedBoostUntil = room.elapsed + LUNGE_SPEED_BOOST;
          e.lungeTelegraph = null;
        }
      } else {
        e.secondCooldown -= dt;
        if (e.secondCooldown <= 0) {
          e.secondCooldown = SECOND_ATTACK_COOLDOWN;
          if (e.name === 'Fenrir') {
            e.lungeTelegraph = { x: nearest.x, y: nearest.y, triggerAt: room.elapsed + LUNGE_TELEGRAPH_TIME };
          } else if (e.name === 'Surtr') {
            const baseAngle = Math.atan2(dy, dx);
            const spread = 0.5;
            for (let i = 0; i < SURTR_FAN_COUNT; i++) {
              const a = baseAngle - spread / 2 + (spread * i) / (SURTR_FAN_COUNT - 1);
              room.enemyProjectiles.push({
                id: room.nextProjId++, x: e.x, y: e.y,
                vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
                damage: Math.round(e.damage * 0.8), life: 2.2,
              });
            }
          } else if (e.name === 'Hel') {
            for (let i = 0; i < HEL_SUMMON_COUNT; i++) summonMinion(room, e.x, e.y);
          }
        }
      }
    }

    e.x += (dx / len) * eSpeed * dt;
    e.y += (dy / len) * eSpeed * dt;
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
        const frenzy = Math.min(FRENZY_MAX_STACKS, p.frenzyStacks || 0);
        p.attackCooldown = Math.round(p.attackCooldownMax * (1 - Math.min(FRENZY_ATKSPEED_CAP, frenzy * FRENZY_ATKSPEED_PER_STACK)));
        const dmg = Math.round(p.damage * (p.synergyActive ? SYNERGY_DAMAGE_MULT : 1) * (room.elapsed < p.damageBoostUntil ? 1.3 : 1) * (1 + frenzy * FRENZY_DAMAGE_PER_STACK));
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
        e.lastHitOwnerId = pr.ownerId;
        const owner = room.players.get(pr.ownerId);
        if (owner) {
          if (pr.isSkill) owner.skillDamageDealt += pr.damage;
          else owner.weaponDamageDealt += pr.damage;
          // evolved-weapon signature procs — only the main weapon attack triggers these, not skills
          if (owner.evolved && !pr.isSkill) {
            if (owner.weapon === 'hammer') {
              e.slowUntil = room.elapsed + HAMMER_STAGGER_DURATION;
            } else if (owner.weapon === 'axe') {
              e.bleedUntil = room.elapsed + AXE_BLEED_DURATION;
              e.bleedDps = Math.max(e.bleedDps || 0, owner.damage * AXE_BLEED_DMG_FRACTION);
              e.bleedOwnerId = owner.id;
            } else if (owner.weapon === 'sword') {
              const cleaveDmg = Math.round(pr.damage * SWORD_CLEAVE_FRACTION);
              for (const other of room.enemies) {
                if (other !== e && distance(e.x, e.y, other.x, other.y) < SWORD_CLEAVE_RADIUS) {
                  other.hp -= cleaveDmg;
                  other.lastHitOwnerId = owner.id;
                  owner.weaponDamageDealt += cleaveDmg;
                }
              }
            }
          }
        }
        if (pr.pierce > 0) { pr.pierce -= 1; continue; }
        return false;
      }
    }
    return true;
  });

  // axe bleed DoT ticks independently of the hit that applied it
  for (const e of room.enemies) {
    if (e.bleedUntil && room.elapsed < e.bleedUntil) {
      const bleedDmg = (e.bleedDps || 0) * dt;
      e.hp -= bleedDmg;
      e.lastHitOwnerId = e.bleedOwnerId;
      const bleedOwner = room.players.get(e.bleedOwnerId);
      if (bleedOwner) bleedOwner.weaponDamageDealt += bleedDmg;
    }
  }

  // remove dead enemies -> spawn xp/gold orbs (+ exploders burst nearby players, world bosses drop a relic)
  const survivors = [];
  // Regular (non-elite, non-boss) kills get merged into one orb per tick below instead of one
  // orb each — a swarm event or an AoE spell clearing a dozen enemies in the same tick used to
  // spawn a dozen separate glowing orbs at once, which is what caused the reported lag spikes.
  let xpBurstValue = 0, xpBurstX = 0, xpBurstY = 0, xpBurstCount = 0;
  for (const e of room.enemies) {
    if (e.hp <= 0) {
      const xpValue = Math.round((e.worldBoss ? 120 : (e.elite ? 25 : 8)) * mod.xpMult);
      if (e.worldBoss || e.elite) {
        room.orbs.push({ id: room.nextOrbId++, x: e.x, y: e.y, value: xpValue });
      } else {
        xpBurstValue += xpValue; xpBurstX += e.x; xpBurstY += e.y; xpBurstCount += 1;
      }
      if (e.worldBoss) {
        room.orbs.push({ id: room.nextOrbId++, x: e.x + 14, y: e.y + 14, value: 0, relic: true });
      }
      // regular-kill drop chance halved from 0.2 — gold was flooding in fast enough that a merchant
      // visit could afford every offer with no tradeoff, which defeated the point of a shop
      const goldAmount = e.worldBoss ? 30 : (e.elite ? 10 : (Math.random() < 0.1 * mod.goldMult ? Math.round(3 * mod.goldMult) : 0));
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
        owner.killsByType[e.type] = (owner.killsByType[e.type] || 0) + 1;
      }
      // frenzy is credited to whoever actually landed the last hit, not just alivePlayers[0]
      // (used only for kill-count/loot attribution above) — otherwise only one player could ever build stacks
      const frenzyOwner = room.players.get(e.lastHitOwnerId);
      if (frenzyOwner && frenzyOwner.alive) {
        frenzyOwner.frenzyStacks = Math.min(FRENZY_MAX_STACKS, (frenzyOwner.frenzyStacks || 0) + 1);
        frenzyOwner.frenzyDecayAt = room.elapsed + FRENZY_DECAY_WINDOW;
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
  if (xpBurstCount > 0) {
    room.orbs.push({ id: room.nextOrbId++, x: xpBurstX / xpBurstCount, y: xpBurstY / xpBurstCount, value: xpBurstValue });
  }

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
      speedBoostRemaining: Math.max(0, Math.round((p.speedBoostUntil - room.elapsed) * 10) / 10),
      damageBoostRemaining: Math.max(0, Math.round((p.damageBoostUntil - room.elapsed) * 10) / 10),
      shieldRemaining: Math.round(Math.max(0, p.invuln) * 10) / 10,
      fireAuraLevel: p.fireAuraLevel, frenzyStacks: p.frenzyStacks,
      weaponDamageDealt: Math.round(p.weaponDamageDealt), skillDamageDealt: Math.round(p.skillDamageDealt), killsByType: p.killsByType,
    })),
    enemies: room.enemies.map((e) => ({
      id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, type: e.type, elite: e.elite, worldBoss: e.worldBoss, name: e.name,
      slamTelegraph: e.slamTelegraph, lungeTelegraph: e.lungeTelegraph,
    })),
    projectiles: room.projectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y, ownerId: pr.ownerId })),
    enemyProjectiles: room.enemyProjectiles.map((pr) => ({ id: pr.id, x: pr.x, y: pr.y })),
    orbs: room.orbs.map((o) => ({ id: o.id, x: o.x, y: o.y, relic: o.relic, gold: o.gold, power: o.power })),
    hazards: room.hazards.map((h) => ({ id: h.id, x: h.x, y: h.y, radius: h.radius, kind: h.kind })),
    treasure: room.treasure ? { x: room.treasure.x, y: room.treasure.y, progress: room.treasure.progress, required: TREASURE_REQUIRED, timer: room.treasure.timer } : null,
    merchant: room.merchant ? { x: room.merchant.x, y: room.merchant.y, expires: room.merchant.expires, offers: room.merchant.offers } : null,
    altar: room.altarActive ? { x: WORLD_W / 2, y: WORLD_H / 2, progress: room.altarActive.progress, required: ALTAR_CHANNEL_TIME, timer: room.altarActive.timer } : null,
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
      const bashDmg = p.damage * 2.5;
      for (const e of room.enemies) {
        if (distance(p.x, p.y, e.x, e.y) < BASH_RADIUS) {
          e.hp -= bashDmg;
          e.lastHitOwnerId = p.id;
          p.skillDamageDealt += bashDmg;
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
          damage: p.damage, pierce: p.piercing, ownerId: p.id, life: 1, isSkill: true,
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
    // each offer is buyable once per player, not once per room — it used to null out the whole
    // room's offer slot on purchase, so only the first player in a co-op group could ever buy anything
    if (offer.boughtBy && offer.boughtBy.includes(p.id)) return;
    const item = MERCHANT_ITEMS.find((it) => it.id === offer.id);
    if (!item) return;
    p.gold -= offer.cost;
    item.apply(p);
    if (!offer.boughtBy) offer.boughtBy = [];
    offer.boughtBy.push(p.id);
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
