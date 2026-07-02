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
const leaderboardList = document.getElementById('leaderboardList');
const enduranceList = document.getElementById('enduranceList');
const waitingPlayerList = document.getElementById('waitingPlayerList');
const achievementToast = document.getElementById('achievementToast');
const goldDisplay = document.getElementById('goldDisplay');
const skillBtn = document.getElementById('skillBtn');
const merchantPanel = document.getElementById('merchantPanel');
const merchantOffers = document.getElementById('merchantOffers');
const weaponDescEl = document.getElementById('weaponDesc');
const classDescEl = document.getElementById('classDesc');

let myId = null;
let latestState = null;
let roomStarted = false;
let relicCount = parseInt(localStorage.getItem('vs_relics') || '0', 10);

// --- Sprites (Kenney "Tiny Dungeon" / "Tiny Creatures", CC0) ---
ctx.imageSmoothingEnabled = false;
function loadSprite(src) {
  const img = new Image();
  img.src = src;
  return img;
}
const SPRITES = {
  playerMe: loadSprite('/assets/player-me.png'),
  playerOther: loadSprite('/assets/player-other.png'),
  wolf: loadSprite('/assets/enemy-wolf.png'),
  skeleton: loadSprite('/assets/enemy-skeleton.png'),
  draugr: loadSprite('/assets/enemy-elite.png'),
  caster: loadSprite('/assets/enemy-caster.png'),
  exploder: loadSprite('/assets/enemy-exploder.png'),
  worldboss: loadSprite('/assets/enemy-worldboss.png'),
  weapon_hammer: loadSprite('/assets/weapon-hammer.png'),
  weapon_axe: loadSprite('/assets/weapon-axe.png'),
  weapon_sword: loadSprite('/assets/weapon-sword.png'),
  gem: loadSprite('/assets/xp-gem.png'),
};
const TILESET = loadSprite('/assets/tileset.png');
const WORLD_SIZE = 2000; // must match server.js WORLD_W/WORLD_H
const REVIVE_TIME = 5; // must match server.js REVIVE_TIME
const POTION_HEAL_CLIENT = 30; // must match server.js POTION_HEAL

const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
function renderMinimap() {
  if (!latestState) return;
  const size = minimapCanvas.width;
  const scale = size / WORLD_SIZE;
  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.save();
  minimapCtx.beginPath();
  minimapCtx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  minimapCtx.clip();
  minimapCtx.fillStyle = 'rgba(20,40,20,0.5)';
  minimapCtx.fillRect(0, 0, size, size);

  // altar landmark at world center
  minimapCtx.fillStyle = 'rgba(212,175,55,0.6)';
  minimapCtx.beginPath();
  minimapCtx.arc((WORLD_SIZE / 2) * scale, (WORLD_SIZE / 2) * scale, 3, 0, Math.PI * 2);
  minimapCtx.fill();

  if (latestState.treasure) {
    minimapCtx.fillStyle = '#f0d060';
    minimapCtx.beginPath();
    minimapCtx.arc(latestState.treasure.x * scale, latestState.treasure.y * scale, 4, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  for (const e of latestState.enemies) {
    minimapCtx.fillStyle = e.worldBoss ? '#c060e0' : (e.elite ? '#ff4040' : '#e06060');
    minimapCtx.beginPath();
    minimapCtx.arc(e.x * scale, e.y * scale, e.worldBoss ? 5 : (e.elite ? 3 : 1.5), 0, Math.PI * 2);
    minimapCtx.fill();
  }
  for (const p of latestState.players) {
    minimapCtx.fillStyle = p.id === myId ? '#f0d060' : '#7ad4f0';
    minimapCtx.beginPath();
    minimapCtx.arc(p.x * scale, p.y * scale, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  minimapCtx.restore();
}

// --- Sound effects (Kenney "RPG Audio" / "Impact Sounds" / "Interface Sounds", CC0) ---
const SFX = {
  hit: '/assets/sfx/hit.ogg',
  kill: '/assets/sfx/kill.ogg',
  pickup: '/assets/sfx/pickup.ogg',
  damage: '/assets/sfx/damage.ogg',
  levelup: '/assets/sfx/levelup.ogg',
  click: '/assets/sfx/click.ogg',
  gameover: '/assets/sfx/gameover.ogg',
};
let sfxLastPlayed = {};
let muted = localStorage.getItem('vs_muted') === '1';
function playSfx(name, { volume = 0.5, throttleMs = 0 } = {}) {
  if (muted) return;
  const now = performance.now();
  if (throttleMs && sfxLastPlayed[name] && now - sfxLastPlayed[name] < throttleMs) return;
  sfxLastPlayed[name] = now;
  const audio = new Audio(SFX[name]);
  audio.volume = volume;
  audio.play().catch(() => {});
}

const muteBtn = document.getElementById('muteBtn');
function updateMuteBtn() { muteBtn.textContent = muted ? '🔇' : '🔊'; }
updateMuteBtn();
muteBtn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('vs_muted', muted ? '1' : '0');
  updateMuteBtn();
});

// --- Language ---
const TRANSLATIONS = {
  th: {
    subtitle: 'รอดชีวิตจากกองทัพดราวเกอร์ให้นานที่สุด ร่วมมือกับเพื่อน!',
    namePlaceholder: 'ชื่อของคุณ (นักรบไวกิ้ง)',
    createRoom: 'สร้างห้องใหม่',
    roomCodePlaceholder: 'รหัสห้อง',
    joinRoom: 'เข้าร่วมห้อง',
    roomLabel: 'ห้อง:',
    shareLinkLabel: 'ส่งลิงก์นี้ให้เพื่อน:',
    copy: 'คัดลอก',
    difficultyLabel: 'ระดับความยาก:',
    diffEasy: 'ง่าย',
    diffNormal: 'ปกติ',
    diffHard: 'ยาก',
    startGame: 'เริ่มเกม ⚔️',
    chooseUpgrade: 'เลือกพลังใหม่!',
    gameOverTitle: 'เกมจบแล้ว',
    playAgain: 'เล่นอีกครั้ง',
    playerCount: (n) => `ผู้เล่นในห้อง: ${n}`,
    defaultName: 'นักรบไร้นาม',
    enterRoomCode: 'กรอกรหัสห้องก่อน',
    roomNotFound: 'ไม่พบห้องนี้',
    alreadyStarted: 'เกมเริ่มไปแล้ว',
    survived: (t) => `รอดชีวิต ${t}`,
    levelKills: (name, lvl, kills) => `${name}: เลเวล ${lvl}, ฆ่า ${kills} ตัว`,
    you: ' (คุณ)',
    leaderboardTitle: 'อันดับผู้รอดชีวิต',
    weaponLabel: 'อาวุธ:',
    weaponHammer: '🔨 ค้อน',
    weaponAxe: '🪓 ขวานคู่',
    weaponSword: '🗡️ ดาบ',
    leaderboardEntry: (i, name, time, lvl) => `${i}. ${name} — ${time} (Lv.${lvl})`,
    noScores: 'ยังไม่มีสถิติ เล่นให้จบสักตาก่อน!',
    achSurvive5: '🏅 รอดชีวิตครบ 5 นาที!',
    achLevel10: '🏅 ถึงเลเวล 10!',
    achBoss: '🏅 ปราบบอส Fenrir/Jörmungandr/Surtr/Hel สำเร็จ!',
    achKills50: '🏅 กำจัดศัตรูครบ 50 ตัว!',
    achMinibosses: '🏅 ปราบบอสประจำตัว ShennyS/POND/POOMPAE/RIPRY ครบ 4 คน!',
    achEvolved: '🏅 วิวัฒน์อาวุธสำเร็จ!',
    relicFound: (n) => `🏺 พบเรลิก! (สะสมแล้ว ${n} ชิ้น — เสริมพลังตอนเริ่มเกมครั้งต่อไป)`,
    weaponEvolved: '✨ อาวุธของคุณวิวัฒน์แล้ว! ดาเมจแรงขึ้นและทะลุศัตรูได้',
    relicLabel: (n) => `🏺 เรลิกที่สะสม: ${n}`,
    treasureLabel: 'ปกป้องสมบัติ!',
    reviveLabel: 'กำลังปลุก...',
    classLabel: 'อาชีพ:',
    classWarrior: '🛡️ นักรบ',
    classArcher: '🏹 นักธนู',
    classMage: '🔮 หมอผี',
    enduranceTitle: '🌌 อันดับโหมด Endless (15 นาที+)',
    merchantTitle: '🛒 พ่อค้าเร่',
    merchantItem_heal: (cost) => `💊 ฟื้นเลือดเต็ม (${cost} ทอง)`,
    merchantItem_maxhp: (cost) => `❤️ +20 เลือดสูงสุด (${cost} ทอง)`,
    merchantItem_damage: (cost) => `⚔️ +6 ดาเมจ (${cost} ทอง)`,
    merchantItem_speed: (cost) => `👟 +25 ความเร็ว (${cost} ทอง)`,
    merchantItem_atkspeed: (cost) => `⚡ โจมตีเร็วขึ้น (${cost} ทอง)`,
    purchaseOk: '✅ ซื้อสำเร็จ!',
    nightLabel: '🌙 กลางคืน — ศัตรูแรงขึ้นแต่ดรอปดีขึ้น',
    endlessLabel: '🌌 โหมด Endless — ความยากเพิ่มต่อเนื่องไม่มีสิ้นสุด',
    modifier_none: 'รอบนี้ไม่มีเงื่อนไขพิเศษ',
    modifier_swift_foes: '🌀 ศัตรูเร็วขึ้น 20% แต่ดรอป XP เพิ่ม 30%',
    modifier_glass_cannon: '💎 ดาเมจ +25% แต่เลือดสูงสุด -20%',
    modifier_blood_moon: '🩸 ศัตรูเลือดเพิ่ม 15% แต่ดรอปทองเพิ่มเท่าตัว',
    modifier_fortune: '🍀 บอสสุ่มเกิดถี่ขึ้นแต่แข็งแกร่งขึ้น',
    modifier_blessed_ground: '✨ ฟื้นฟูเลือดพาสซีฟ +0.5/วิ ให้ทุกคน',
    skillReady: 'ทักษะพร้อมใช้ (กด Space)',
    powerup_potion: `💊 ยาเพิ่มเลือด +${POTION_HEAL_CLIENT}`,
    powerup_speedboost: '💨 เร่งความเร็ว! (8 วิ)',
    powerup_damageboost: '🔥 พลังโจมตีเพิ่มขึ้น! (8 วิ)',
    weaponDesc_hammer: 'สมดุลทุกด้าน ไม่มีจุดเด่นจุดด้อย เหมาะกับผู้เริ่มต้น',
    weaponDesc_axe: 'โจมตีเร็วขึ้น 50% แต่ดาเมจต่อครั้งลดลง 30% เหมาะกับสายตีรัว',
    weaponDesc_sword: 'ระยะโจมตีไกลขึ้น 35% แต่ดาเมจลดลง 15% เหมาะกับสายตั้งรับ',
    classDesc_warrior: 'เลือดสูงสุด +25% เดินช้าลง 5% สกิล (Space): ฟันรอบตัวสร้างดาเมจ 2.5 เท่าใส่ศัตรูรอบตัว',
    classDesc_archer: 'เลือดสูงสุด -15% ดาเมจ +5% เดินเร็วขึ้น 10% สกิล (Space): ยิงกระสุน 10 ทิศทางรอบตัวทันที',
    classDesc_mage: 'เลือดสูงสุด -10% ดาเมจ -5% สกิล (Space): ฮีลตัวเองและเพื่อนในระยะใกล้ 30% ของเลือดสูงสุด',
  },
  en: {
    subtitle: 'Survive the draugr horde as long as you can. Team up with friends!',
    namePlaceholder: 'Your name (Viking warrior)',
    createRoom: 'Create Room',
    roomCodePlaceholder: 'Room Code',
    joinRoom: 'Join Room',
    roomLabel: 'Room:',
    shareLinkLabel: 'Send this link to your friend:',
    copy: 'Copy',
    difficultyLabel: 'Difficulty:',
    diffEasy: 'Easy',
    diffNormal: 'Normal',
    diffHard: 'Hard',
    startGame: 'Start Game ⚔️',
    chooseUpgrade: 'Choose a new power!',
    gameOverTitle: 'Game Over',
    playAgain: 'Play Again',
    playerCount: (n) => `Players in room: ${n}`,
    defaultName: 'Unnamed Warrior',
    enterRoomCode: 'Enter a room code first',
    roomNotFound: 'Room not found',
    alreadyStarted: 'Game already started',
    survived: (t) => `Survived ${t}`,
    levelKills: (name, lvl, kills) => `${name}: Level ${lvl}, ${kills} kills`,
    you: ' (you)',
    leaderboardTitle: 'Top Survivors',
    weaponLabel: 'Weapon:',
    weaponHammer: '🔨 Hammer',
    weaponAxe: '🪓 Twin Axe',
    weaponSword: '🗡️ Sword',
    leaderboardEntry: (i, name, time, lvl) => `${i}. ${name} — ${time} (Lv.${lvl})`,
    noScores: 'No scores yet — finish a run first!',
    achSurvive5: '🏅 Survived 5 minutes!',
    achLevel10: '🏅 Reached level 10!',
    achBoss: '🏅 Defeated a world boss!',
    achKills50: '🏅 Defeated 50 enemies!',
    achMinibosses: '🏅 Defeated all 4 named bosses (ShennyS/POND/POOMPAE/RIPRY)!',
    achEvolved: '🏅 Evolved your weapon!',
    relicFound: (n) => `🏺 Relic found! (${n} collected — boosts your next run)`,
    weaponEvolved: '✨ Your weapon has evolved! More damage and it pierces enemies now',
    relicLabel: (n) => `🏺 Relics collected: ${n}`,
    treasureLabel: 'Defend the treasure!',
    reviveLabel: 'Reviving...',
    classLabel: 'Class:',
    classWarrior: '🛡️ Warrior',
    classArcher: '🏹 Archer',
    classMage: '🔮 Mage',
    enduranceTitle: '🌌 Endless Mode Rankings (15min+)',
    merchantTitle: '🛒 Traveling Merchant',
    merchantItem_heal: (cost) => `💊 Full heal (${cost} gold)`,
    merchantItem_maxhp: (cost) => `❤️ +20 max HP (${cost} gold)`,
    merchantItem_damage: (cost) => `⚔️ +6 damage (${cost} gold)`,
    merchantItem_speed: (cost) => `👟 +25 speed (${cost} gold)`,
    merchantItem_atkspeed: (cost) => `⚡ Faster attack (${cost} gold)`,
    purchaseOk: '✅ Purchased!',
    nightLabel: '🌙 Night — enemies are stronger but drop more',
    endlessLabel: '🌌 Endless Mode — difficulty keeps climbing forever',
    modifier_none: 'No special condition this run',
    modifier_swift_foes: '🌀 Enemies 20% faster, but 30% more XP',
    modifier_glass_cannon: '💎 +25% damage, but -20% max HP',
    modifier_blood_moon: '🩸 Enemies 15% tankier, but double gold drops',
    modifier_fortune: '🍀 Bosses spawn more often but hit harder',
    modifier_blessed_ground: '✨ Everyone regens +0.5 HP/s',
    skillReady: 'Skill ready (press Space)',
    powerup_potion: `💊 Heal potion +${POTION_HEAL_CLIENT}`,
    powerup_speedboost: '💨 Speed boost! (8s)',
    powerup_damageboost: '🔥 Damage boost! (8s)',
    weaponDesc_hammer: 'Balanced all-round, no strengths or weaknesses. Good for beginners.',
    weaponDesc_axe: '50% faster attacks, but 30% less damage per hit. Great for rapid strikes.',
    weaponDesc_sword: '35% longer range, but 15% less damage. Great for kiting.',
    classDesc_warrior: '+25% max HP, 5% slower. Skill (Space): melee smash hits all enemies nearby for 2.5x damage.',
    classDesc_archer: '-15% max HP, +5% damage, 10% faster. Skill (Space): instantly fire 10 shots in all directions.',
    classDesc_mage: '-10% max HP, -5% damage. Skill (Space): heal yourself and nearby allies for 30% of max HP.',
  },
};
const UPGRADE_TEXT = {
  th: {
    damage: '⚔️ เพิ่มดาเมจ', atkspeed: '⚡ โจมตีเร็วขึ้น', speed: '👟 เคลื่อนไหวขึ้น',
    hp: '❤️ เลือดสูงสุดเพิ่ม', range: '🏹 ระยะโจมไกลขึ้น', multishot: '🌀 ยิงหลายทิศทาง',
    regen: '🌿 ฟื้นฟูเลือด', magnet: '🧲 ดูดพลังไกลขึ้น',
  },
  en: {
    damage: '⚔️ Increase Damage', atkspeed: '⚡ Faster Attack', speed: '👟 Move Faster',
    hp: '❤️ More Max HP', range: '🏹 Longer Range', multishot: '🌀 Multi-shot',
    regen: '🌿 HP Regen', magnet: '🧲 Bigger Pickup Range',
  },
};
let lang = localStorage.getItem('vs_lang') || 'th';
function t(key, ...args) {
  const v = TRANSLATIONS[lang][key];
  return typeof v === 'function' ? v(...args) : v;
}
function applyTranslations() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  langBtn.textContent = lang === 'th' ? 'EN' : 'TH';
  if (typeof updateWeaponDesc === 'function') updateWeaponDesc();
  if (typeof updateClassDesc === 'function') updateClassDesc();
}
const langBtn = document.getElementById('langBtn');
langBtn.addEventListener('click', () => {
  lang = lang === 'th' ? 'en' : 'th';
  localStorage.setItem('vs_lang', lang);
  applyTranslations();
});
applyTranslations();

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

socket.on('connect', () => {
  myId = socket.id;
  socket.emit('setRelics', relicCount);
});

socket.on('relicPickup', (count) => {
  relicCount = count;
  localStorage.setItem('vs_relics', String(relicCount));
  socket.emit('setRelics', relicCount);
  toastQueue.push(t('relicFound', relicCount));
  showNextToast();
});

socket.on('weaponEvolved', () => {
  toastQueue.push(t('weaponEvolved'));
  showNextToast();
});

socket.on('powerupPickup', (kind) => {
  playSfx('pickup', { volume: 0.3 });
  toastQueue.push(t('powerup_' + kind));
  showNextToast();
});

// --- Lobby flow ---
const params = new URLSearchParams(location.search);
const prefillRoom = params.get('room');
if (prefillRoom) roomInput.value = prefillRoom.toUpperCase();

document.getElementById('createBtn').addEventListener('click', () => {
  playSfx('click', { volume: 0.4 });
  const name = nameInput.value.trim() || t('defaultName');
  socket.emit('createRoom', name, (res) => {
    enterWaitingRoom(res.roomId);
  });
});

document.getElementById('joinBtn').addEventListener('click', () => {
  playSfx('click', { volume: 0.4 });
  const name = nameInput.value.trim() || t('defaultName');
  const code = roomInput.value.trim().toUpperCase();
  if (!code) { lobbyMsg.textContent = t('enterRoomCode'); return; }
  socket.emit('joinRoom', code, name, (res) => {
    if (res.error) { lobbyMsg.textContent = t(res.error); return; }
    enterWaitingRoom(res.roomId);
  });
});

function enterWaitingRoom(roomId) {
  lobby.classList.add('hidden');
  waitingRoom.classList.remove('hidden');
  roomCodeEl.textContent = roomId;
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  shareLink.value = url;
  document.getElementById('relicDisplay').textContent = t('relicLabel', relicCount);
}

document.getElementById('copyBtn').addEventListener('click', () => {
  shareLink.select();
  navigator.clipboard.writeText(shareLink.value);
});

document.getElementById('playAgainBtn').addEventListener('click', () => location.reload());

document.getElementById('startBtn').addEventListener('click', () => {
  playSfx('click', { volume: 0.4 });
  const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
  socket.emit('startGame', difficulty);
});

function updateWeaponDesc() {
  const val = document.querySelector('input[name="weapon"]:checked').value;
  weaponDescEl.textContent = t('weaponDesc_' + val);
}
function updateClassDesc() {
  const val = document.querySelector('input[name="class"]:checked').value;
  classDescEl.textContent = t('classDesc_' + val);
}

document.querySelectorAll('input[name="weapon"]').forEach((el) => {
  el.addEventListener('change', () => {
    socket.emit('setWeapon', el.value);
    updateWeaponDesc();
  });
});

document.querySelectorAll('input[name="class"]').forEach((el) => {
  el.addEventListener('change', () => {
    socket.emit('setClass', el.value);
    updateClassDesc();
  });
});
updateWeaponDesc();
updateClassDesc();

socket.on('lobbyUpdate', ({ players }) => {
  waitingPlayerList.innerHTML = players.map((p) => `<span>${p.name}</span>`).join('');
});

function renderLeaderboard(list) {
  if (!list || list.length === 0) {
    leaderboardList.innerHTML = `<li style="list-style:none">${t('noScores')}</li>`;
    return;
  }
  leaderboardList.innerHTML = list
    .map((e, i) => `<li>${t('leaderboardEntry', i + 1, e.name, formatTime(e.elapsed), e.level)}</li>`)
    .join('');
}
socket.on('leaderboard', (list) => renderLeaderboard(list));

function renderEnduranceLeaderboard(list) {
  if (!list || list.length === 0) {
    enduranceList.innerHTML = `<li style="list-style:none">${t('noScores')}</li>`;
    return;
  }
  enduranceList.innerHTML = list
    .map((e, i) => `<li>${t('leaderboardEntry', i + 1, e.name, formatTime(e.elapsed), e.level)}</li>`)
    .join('');
}
socket.on('enduranceLeaderboard', (list) => renderEnduranceLeaderboard(list));

socket.on('runModifier', (id) => {
  toastQueue.push(t('modifier_' + id));
  showNextToast();
});

socket.on('purchaseOk', () => {
  toastQueue.push(t('purchaseOk'));
  showNextToast();
});

// --- Achievements (client-side, unlocked state kept in localStorage) ---
const unlockedAchievements = new Set(JSON.parse(localStorage.getItem('vs_achievements') || '[]'));
let toastQueue = [];
let toastShowing = false;
function unlockAchievement(id, textKey) {
  if (unlockedAchievements.has(id)) return;
  unlockedAchievements.add(id);
  localStorage.setItem('vs_achievements', JSON.stringify([...unlockedAchievements]));
  toastQueue.push(t(textKey));
  showNextToast();
}
function showNextToast() {
  if (toastShowing || toastQueue.length === 0) return;
  toastShowing = true;
  achievementToast.textContent = toastQueue.shift();
  achievementToast.classList.remove('hidden');
  setTimeout(() => {
    achievementToast.classList.add('hidden');
    setTimeout(() => { toastShowing = false; showNextToast(); }, 400);
  }, 3000);
}
function checkAchievements(state) {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  if (state.elapsed >= 300) unlockAchievement('survive5', 'achSurvive5');
  if (me.level >= 10) unlockAchievement('level10', 'achLevel10');
  if (me.worldBossKills >= 1) unlockAchievement('boss', 'achBoss');
  if (me.kills >= 50) unlockAchievement('kills50', 'achKills50');
  if (me.eliteKills >= 4) unlockAchievement('minibosses', 'achMinibosses');
  if (me.evolved) unlockAchievement('evolved', 'achEvolved');
}

// --- Particles & juice ---
let particles = [];
let levelBursts = [];
let damageNumbers = [];

const MAX_DAMAGE_NUMBERS = 150; // long fights spawn a lot of these; cap so rendering doesn't slow down
function spawnDamageNumber(x, y, amount, color, big) {
  if (damageNumbers.length > MAX_DAMAGE_NUMBERS) damageNumbers.splice(0, damageNumbers.length - MAX_DAMAGE_NUMBERS);
  damageNumbers.push({
    x, y: y - 14, amount: Math.round(amount), color, big,
    life: 0.7, maxLife: 0.7,
    vx: (Math.random() - 0.5) * 20,
  });
}
const hitFlashes = new Map(); // enemyId -> timestamp
const playerFacing = new Map(); // playerId -> 1 (right) | -1 (left)
const playerMoving = new Map(); // playerId -> timestamp of last detected movement
let shake = { time: 0, magnitude: 0 };
let damageFlash = 0;

// --- Class skill effects ---
let skillEffects = [];
socket.on('skillEffect', (fx) => {
  skillEffects.push({ ...fx, maxLife: 0.5, startedAt: performance.now() });
  const color = fx.type === 'bash' ? '#ff8040' : fx.type === 'heal' ? '#7ae08a' : '#7ad4f0';
  spawnParticles(fx.x, fx.y, color, 14, 160, 0.4);
  if (fx.type === 'bash') triggerShake(6, 0.15);
});
function renderSkillEffects(cam, now) {
  skillEffects = skillEffects.filter((fx) => {
    const elapsed = (now - fx.startedAt) / 1000;
    if (elapsed > fx.maxLife) return false;
    const progress = elapsed / fx.maxLife;
    const s = worldToScreen(fx.x, fx.y, cam);
    if (fx.type === 'bash') {
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#ff8040';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(s.x, s.y, (fx.radius || 100) * progress, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (fx.type === 'volley') {
      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.6;
      ctx.fillStyle = '#7ad4f0';
      ctx.beginPath(); ctx.arc(s.x, s.y, 30 * (1 - progress) + 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (fx.type === 'heal') {
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#4caf50';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, (fx.radius || 200) * progress, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    return true;
  });
}

// ambient embers drifting upward, screen-space (purely decorative)
const embers = Array.from({ length: 36 }, () => ({
  x: Math.random(),
  y: Math.random(),
  speed: 8 + Math.random() * 14,
  drift: (Math.random() - 0.5) * 6,
  size: 1 + Math.random() * 2,
  phase: Math.random() * Math.PI * 2,
}));

const MAX_PARTICLES = 500; // long fights with lots of kills can spike this; cap so it can't snowball
function spawnParticles(x, y, color, count, speed, life) {
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
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

const ENEMY_PARTICLE_COLOR = {
  wolf: '#c0c8d8', skeleton: '#e8e0c8', draugr: '#7ada7a',
  caster: '#8a7ad8', exploder: '#f0a040', worldboss: '#c060e0',
};

// --- Game state updates ---
// Client-side interpolation: the server only broadcasts positions 20x/sec (SERVER_TICK_MS),
// but the canvas draws every animation frame (60/120/144Hz). Without smoothing, entities
// visibly snap into place every ~50ms no matter how high the display refresh rate is.
// We keep the last two snapshots and blend positions between them based on elapsed time.
const SERVER_TICK_MS = 50;
let prevServerState = null;
let curServerReceivedAt = 0;

socket.on('state', (state) => {
  if (latestState) diffEffects(latestState, state);
  prevServerState = latestState;
  curServerReceivedAt = performance.now();
  latestState = state;
  if (state.started && !roomStarted) {
    roomStarted = true;
    waitingRoom.classList.add('hidden');
    gameScreen.classList.remove('hidden');
  }
  playerCount.textContent = t('playerCount', state.players.length);
  if (roomStarted) {
    updateHud(state);
    checkAchievements(state);
  }
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
      playSfx('kill', { volume: e.elite ? 0.6 : 0.35, throttleMs: 40 });
    }
  }
  for (const e of newState.enemies) {
    const old = oldEnemies.get(e.id);
    if (old && e.hp < old.hp) {
      hitFlashes.set(e.id, performance.now());
      spawnParticles(e.x, e.y, '#ffe08a', 3, 80, 0.25);
      spawnDamageNumber(e.x, e.y, old.hp - e.hp, '#f0d060', e.elite);
      playSfx('hit', { volume: 0.2, throttleMs: 60 });
    }
  }
  const oldPlayers = new Map(oldState.players.map((p) => [p.id, p]));
  for (const p of newState.players) {
    const old = oldPlayers.get(p.id);
    if (old && p.hp < old.hp) {
      spawnParticles(p.x, p.y, '#e06060', 6, 100, 0.3);
      spawnDamageNumber(p.x, p.y, old.hp - p.hp, '#e06060', false);
      if (p.id === myId) {
        triggerShake(8, 0.25);
        damageFlash = 0.35;
        playSfx('damage', { volume: 0.45 });
      }
    }
    if (old && p.level > old.level) {
      levelBursts.push({ x: p.x, y: p.y, life: 0.6, maxLife: 0.6 });
      spawnParticles(p.x, p.y, '#f0d060', 18, 160, 0.6);
      if (p.id === myId) playSfx('levelup', { volume: 0.5 });
    }
    if (old && p.xp > old.xp && p.level === old.level) {
      if (p.id === myId) playSfx('pickup', { volume: 0.15, throttleMs: 120 });
    }
    if (old && Math.abs(p.x - old.x) > 0.5) {
      playerFacing.set(p.id, p.x > old.x ? 1 : -1);
    }
    if (old && (Math.abs(p.x - old.x) > 0.5 || Math.abs(p.y - old.y) > 0.5)) {
      playerMoving.set(p.id, performance.now());
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

// --- Touch joystick (mobile) ---
const touchJoystick = document.getElementById('touchJoystick');
const joystickBase = document.getElementById('joystickBase');
const joystickKnob = document.getElementById('joystickKnob');
let touchInput = { x: 0, y: 0, active: false };

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  touchJoystick.classList.remove('hidden');
  skillBtn.classList.remove('hidden');
}

function triggerSkill() {
  if (!roomStarted) return;
  playSfx('click', { volume: 0.3 });
  socket.emit('useSkill');
}
skillBtn.addEventListener('click', triggerSkill);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); triggerSkill(); }
});

function handleJoystickMove(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  const max = rect.width / 2;
  if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
  joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  touchInput.x = dx / max;
  touchInput.y = dy / max;
  touchInput.active = true;
}
function resetJoystick() {
  touchInput = { x: 0, y: 0, active: false };
  joystickKnob.style.transform = 'translate(-50%, -50%)';
}
joystickBase.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  handleJoystickMove(t.clientX, t.clientY);
}, { passive: false });
joystickBase.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  handleJoystickMove(t.clientX, t.clientY);
}, { passive: false });
joystickBase.addEventListener('touchend', (e) => {
  e.preventDefault();
  resetJoystick();
}, { passive: false });

let lastSentDx = null, lastSentDy = null;
let lastMoveDir = { x: 0, y: -1 };
setInterval(() => {
  if (!roomStarted) return;
  let dx = 0, dy = 0;
  if (touchInput.active) {
    dx = touchInput.x;
    dy = touchInput.y;
  } else {
    if (keys.w || keys.ArrowUp) dy -= 1;
    if (keys.s || keys.ArrowDown) dy += 1;
    if (keys.a || keys.ArrowLeft) dx -= 1;
    if (keys.d || keys.ArrowRight) dx += 1;
  }
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

function distanceClient(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Interpolation maps built once per frame; ipos() looks up an entity's previous-tick
// position (by id) and blends toward its current position using the frame's alpha.
let interpMaps = null;
let interpAlpha = 1;
function buildInterpMaps(now) {
  if (!prevServerState) { interpMaps = null; interpAlpha = 1; return; }
  interpAlpha = Math.max(0, Math.min(1.4, (now - curServerReceivedAt) / SERVER_TICK_MS));
  interpMaps = {
    players: new Map(prevServerState.players.map((p) => [p.id, p])),
    enemies: new Map(prevServerState.enemies.map((e) => [e.id, e])),
    projectiles: new Map(prevServerState.projectiles.map((p) => [p.id, p])),
    enemyProjectiles: new Map((prevServerState.enemyProjectiles || []).map((p) => [p.id, p])),
    orbs: new Map(prevServerState.orbs.map((o) => [o.id, o])),
  };
}
function ipos(entity, kind) {
  if (!interpMaps) return entity;
  const prev = interpMaps[kind].get(entity.id);
  if (!prev) return entity;
  return {
    x: prev.x + (entity.x - prev.x) * interpAlpha,
    y: prev.y + (entity.y - prev.y) * interpAlpha,
  };
}

function drawSprite(img, x, y, size, opts = {}) {
  if (!img.complete || img.naturalWidth === 0) return;
  const { rotation = 0, flip = 1, flash = false, alpha = 1, scaleX = 1, scaleY = 1 } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  ctx.scale(flip * scaleX, scaleY);
  if (flash) ctx.filter = 'brightness(2.5)';
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

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
  damageNumbers = damageNumbers.filter((d) => {
    d.life -= dt;
    d.y -= 35 * dt;
    d.x += d.vx * dt;
    return d.life > 0;
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

// nature decoration sprites, cut from the Kenney "Roguelike/RPG" tileset (16x16, 1px margin)
const NATURE_SRC = {
  tree1: { x: 221, y: 170 },
  tree2: { x: 238, y: 170 },
  pine: { x: 272, y: 170 },
  bushGreen: { x: 340, y: 153 },
  bushOrange: { x: 357, y: 153 },
  bushTeal: { x: 374, y: 153 },
  sprout: { x: 391, y: 170 },
};
const NATURE_KEYS = Object.keys(NATURE_SRC);

function drawTile(img, src, x, y, size) {
  if (!img.complete || img.naturalWidth === 0) return;
  ctx.drawImage(img, src.x, src.y, 16, 16, x - size / 2, y - size, size, size);
}

function drawRock(x, y, size) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, y + size * 0.28, size * 0.5, size * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3f4d';
  ctx.beginPath(); ctx.ellipse(x, y, size * 0.5, size * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b6274';
  ctx.beginPath(); ctx.ellipse(x - size * 0.12, y - size * 0.1, size * 0.3, size * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawNature(cam) {
  const cell = 190;
  const startCol = Math.floor((cam.x - canvas.width / 2) / cell) - 1;
  const endCol = Math.floor((cam.x + canvas.width / 2) / cell) + 1;
  const startRow = Math.floor((cam.y - canvas.height / 2) / cell) - 1;
  const endRow = Math.floor((cam.y + canvas.height / 2) / cell) + 1;
  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const h1 = Math.abs(Math.sin(col * 91.3 + row * 57.1) * 24634.634) % 1;
      if (h1 > 0.62) continue; // dense forest coverage
      const wx = col * cell + ((h1 * 733) % cell);
      const wy = row * cell + ((h1 * 911) % cell);
      const s = worldToScreen(wx, wy, cam);
      if (s.x < -60 || s.x > canvas.width + 60 || s.y < -100 || s.y > canvas.height + 60) continue;
      const h2 = Math.abs(Math.sin(col * 12.9 + row * 78.2 + 4.7) * 12345.678) % 1;
      if (h2 < 0.15) {
        drawRock(s.x, s.y, 14 + h2 * 60);
      } else {
        const type = NATURE_KEYS[Math.floor(h2 * NATURE_KEYS.length * 97) % NATURE_KEYS.length];
        const size = type === 'tree1' || type === 'tree2' || type === 'pine' ? 42 : 22;
        drawTile(TILESET, NATURE_SRC[type], s.x, s.y, size);
      }
    }
  }
}

function drawAltar(cam, t) {
  const wx = WORLD_SIZE / 2, wy = WORLD_SIZE / 2;
  const s = worldToScreen(wx, wy, cam);
  if (s.x < -150 || s.x > canvas.width + 150 || s.y < -150 || s.y > canvas.height + 150) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(s.x, s.y + 12, 70, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#454b58';
  ctx.beginPath(); ctx.ellipse(s.x, s.y, 66, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5c6272';
  ctx.beginPath(); ctx.ellipse(s.x, s.y - 6, 48, 28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3f4c';
  ctx.beginPath(); ctx.ellipse(s.x, s.y - 8, 26, 15, 0, 0, Math.PI * 2); ctx.fill();
  const glow = 0.5 + 0.35 * Math.sin(t / 400);
  ctx.shadowColor = '#d4af37';
  ctx.shadowBlur = 18;
  ctx.fillStyle = `rgba(212,175,55,${glow})`;
  ctx.font = 'bold 30px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ᛟ', s.x, s.y - 8);
  ctx.restore();
}

function drawBackground(cam, t) {
  const bgGrad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, canvas.height
  );
  bgGrad.addColorStop(0, '#2a3f22');
  bgGrad.addColorStop(0.6, '#1c2e18');
  bgGrad.addColorStop(1, '#101c0d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(120,150,90,0.18)';
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
  buildInterpMaps(now);
  const meRaw = latestState.players.find((p) => p.id === myId) || latestState.players[0];
  const me = meRaw ? { ...meRaw, ...ipos(meRaw, 'players') } : null;
  const shakeX = shake.time > 0 ? (Math.random() - 0.5) * shake.magnitude : 0;
  const shakeY = shake.time > 0 ? (Math.random() - 0.5) * shake.magnitude : 0;
  const cam = me ? { x: me.x - shakeX, y: me.y - shakeY } : { x: 1000, y: 1000 };

  drawBackground(cam, now);
  drawNature(cam);
  drawAltar(cam, now);
  drawEmbers(dt);

  // warm light pooling under each living player
  for (const p of latestState.players) {
    if (!p.alive) continue;
    const lp = ipos(p, 'players');
    const s = worldToScreen(lp.x, lp.y, cam);
    const lightGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 140);
    lightGrad.addColorStop(0, 'rgba(212,175,55,0.12)');
    lightGrad.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.fillStyle = lightGrad;
    ctx.fillRect(s.x - 140, s.y - 140, 280, 280);
  }

  // orbs (pulsing glow) — relics glow gold, gold coins render as coins, XP stays blue
  for (const o of latestState.orbs) {
    const op = ipos(o, 'orbs');
    const s = worldToScreen(op.x, op.y, cam);
    const pulse = 1 + 0.2 * Math.sin(now / 150 + o.id);
    if (o.gold) {
      ctx.save();
      ctx.shadowColor = '#f0d060';
      ctx.shadowBlur = 10;
      ctx.font = `${16 * pulse}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪙', s.x, s.y);
      ctx.restore();
      continue;
    }
    if (o.power) {
      const icon = o.power === 'potion' ? '💊' : o.power === 'speedboost' ? '💨' : '🔥';
      const glow = o.power === 'potion' ? '#7ae08a' : o.power === 'speedboost' ? '#7ad4f0' : '#f08040';
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 14;
      ctx.font = `${20 * pulse}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, s.x, s.y);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.shadowColor = o.relic ? '#f0d060' : '#3aa0d4';
    ctx.shadowBlur = o.relic ? 18 : 10;
    drawSprite(SPRITES.gem, s.x, s.y, (o.relic ? 26 : 18) * pulse);
    ctx.restore();
  }

  // traveling merchant NPC
  if (latestState.merchant) {
    const s = worldToScreen(latestState.merchant.x, latestState.merchant.y, cam);
    ctx.save();
    ctx.shadowColor = '#d4af37';
    ctx.shadowBlur = 14;
    ctx.font = '32px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧙', s.x, s.y);
    ctx.restore();
    ctx.fillStyle = '#d4af37';
    ctx.font = 'bold 13px Georgia';
    ctx.fillText(t('merchantTitle'), s.x, s.y - 30);
  }

  // treasure event: a chest players must stand near to claim
  if (latestState.treasure) {
    const tr = latestState.treasure;
    const s = worldToScreen(tr.x, tr.y, cam);
    const pulse = 1 + 0.1 * Math.sin(now / 200);
    ctx.save();
    ctx.shadowColor = '#f0d060';
    ctx.shadowBlur = 16;
    ctx.font = `${34 * pulse}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📦', s.x, s.y);
    ctx.restore();
    const ringR = 26;
    ctx.save();
    ctx.strokeStyle = 'rgba(240,208,96,0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#f0d060';
    ctx.beginPath();
    ctx.arc(s.x, s.y, ringR, -Math.PI / 2, -Math.PI / 2 + (tr.progress / tr.required) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#f0d060';
    ctx.font = 'bold 13px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText(t('treasureLabel'), s.x, s.y - 44);
  }

  // projectiles: spinning weapon matching each player's chosen loadout
  const weaponByOwner = new Map(latestState.players.map((p) => [p.id, p.weapon || 'hammer']));
  for (const pr of latestState.projectiles) {
    const prp = ipos(pr, 'projectiles');
    const s = worldToScreen(prp.x, prp.y, cam);
    ctx.save();
    ctx.shadowColor = '#d4af37';
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(240,208,96,0.4)'; ctx.fill();
    ctx.restore();
    const weaponSprite = SPRITES['weapon_' + (weaponByOwner.get(pr.ownerId) || 'hammer')] || SPRITES.weapon_hammer;
    drawSprite(weaponSprite, s.x, s.y, 20, { rotation: (now / 80 + (pr.id || 0)) % (Math.PI * 2) });
  }

  // enemy projectiles: glowing magic bolts
  for (const pr of (latestState.enemyProjectiles || [])) {
    const erp = ipos(pr, 'enemyProjectiles');
    const s = worldToScreen(erp.x, erp.y, cam);
    ctx.save();
    ctx.shadowColor = '#8a7ad8';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#b8a0f0';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // enemies
  const ENEMY_SPRITE = {
    wolf: SPRITES.wolf, skeleton: SPRITES.skeleton, draugr: SPRITES.draugr,
    caster: SPRITES.caster, exploder: SPRITES.exploder, worldboss: SPRITES.worldboss,
  };
  for (const e of latestState.enemies) {
    const ep = ipos(e, 'enemies');
    const base = worldToScreen(ep.x, ep.y, cam);
    const bob = Math.sin(now / 180 + e.id) * 2.5;
    const s = { x: base.x, y: base.y + bob };
    const flashedAt = hitFlashes.get(e.id);
    const isFlashing = flashedAt && now - flashedAt < 120;

    if (e.elite) {
      const auraColor = e.worldBoss ? '192,96,224' : '224,96,96';
      const auraR = (e.worldBoss ? 38 : 26) + 4 * Math.sin(now / 200);
      ctx.save();
      ctx.strokeStyle = `rgba(${auraColor},0.6)`;
      ctx.lineWidth = e.worldBoss ? 3 : 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, auraR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(${auraColor},0.3)`;
      ctx.beginPath(); ctx.arc(s.x, s.y, auraR + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    const size = e.worldBoss ? 64 : (e.elite ? 44 : 30);
    const walk = Math.sin(now / 110 + e.id);
    drawSprite(ENEMY_SPRITE[e.type] || SPRITES.skeleton, s.x, s.y, size, {
      flash: isFlashing, scaleX: 1 - walk * 0.06, scaleY: 1 + walk * 0.06,
    });

    const w = e.worldBoss ? 74 : (e.elite ? 50 : 26);
    const barY = e.worldBoss ? -48 : (e.elite ? -34 : -24);
    if (e.elite && e.name) {
      ctx.fillStyle = e.worldBoss ? '#c060e0' : '#e06060';
      ctx.font = e.worldBoss ? 'bold 17px Georgia' : 'bold 14px Georgia';
      ctx.fillText(`☠ ${e.name} ☠`, s.x, s.y - (e.worldBoss ? 62 : 44));
    }
    ctx.fillStyle = '#402020';
    ctx.fillRect(s.x - w / 2, s.y + barY, w, 5);
    ctx.fillStyle = e.worldBoss ? '#c060e0' : (e.elite ? '#e06060' : '#c0392b');
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
  for (const p of latestState.players) {
    const pp = ipos(p, 'players');
    const isMoving = p.alive && (now - (playerMoving.get(p.id) || 0)) < 150;
    const bobSpeed = isMoving ? 90 : 500;
    const bob = p.alive ? Math.sin(now / bobSpeed + pp.x * 0.01) * (isMoving ? 3 : 1) : 0;
    const base = worldToScreen(pp.x, pp.y, cam);
    const s = { x: base.x, y: base.y + bob };
    const facing = playerFacing.get(p.id) || 1;
    const walk = isMoving ? Math.sin(now / 90) : 0;

    if (p.alive && p.synergyActive) {
      ctx.save();
      ctx.strokeStyle = `rgba(122,212,240,${0.35 + 0.15 * Math.sin(now / 250)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (p.id === myId) {
      ctx.shadowColor = '#d4af37';
      ctx.shadowBlur = 12;
    }
    if (p.evolved) {
      ctx.shadowColor = '#c060e0';
      ctx.shadowBlur = 16;
    }
    drawSprite(p.id === myId ? SPRITES.playerMe : SPRITES.playerOther, s.x, s.y, 34, {
      flip: facing, alpha: p.alive ? 1 : 0.3,
      scaleX: 1 - walk * 0.07, scaleY: 1 + walk * 0.07,
    });
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

    if (p.alive && (p.speedBoostActive || p.damageBoostActive)) {
      ctx.font = '14px serif';
      ctx.textAlign = 'center';
      const icons = (p.speedBoostActive ? '💨' : '') + (p.damageBoostActive ? '🔥' : '');
      ctx.fillText(icons, s.x + 16, s.y - 20);
      ctx.font = '26px serif';
    }

    if (!p.alive && p.reviveProgress > 0) {
      const reviveFrac = Math.min(1, p.reviveProgress / REVIVE_TIME);
      ctx.save();
      ctx.strokeStyle = 'rgba(76,175,80,0.3)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#4caf50';
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, -Math.PI / 2, -Math.PI / 2 + reviveFrac * Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#4caf50';
      ctx.font = 'bold 12px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText(t('reviveLabel'), s.x, s.y - 40);
    }
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

  // floating damage numbers
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of damageNumbers) {
    const s = worldToScreen(d.x, d.y, cam);
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / d.maxLife * 1.4);
    ctx.font = d.big ? 'bold 20px Georgia' : 'bold 14px Georgia';
    ctx.fillStyle = d.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(String(d.amount), s.x, s.y);
    ctx.fillText(String(d.amount), s.x, s.y);
    ctx.restore();
  }

  if (damageFlash > 0) {
    ctx.fillStyle = `rgba(180,20,20,${damageFlash * 0.4})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (latestState.night) {
    ctx.fillStyle = 'rgba(5,10,35,0.32)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  renderSkillEffects(cam, now);
  renderMinimap();
}
render();

function formatTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateHud(state) {
  timerEl.textContent = formatTime(state.elapsed) + (state.night ? ' 🌙' : '') + (state.endless ? ' 🌌' : '');
  timerEl.title = state.endless ? t('endlessLabel') : (state.night ? t('nightLabel') : '');
  statsPanel.innerHTML = state.players.map((p) => `
    <div class="pstat">
      <strong>${p.name}${p.id === myId ? t('you') : ''}</strong> — Lv.${p.level} ${p.alive ? '' : '💀'}
      <div class="bar"><div class="bar-fill" style="width:${Math.max(0, (p.hp / p.maxHp) * 100)}%"></div></div>
      <div class="bar"><div class="bar-fill xp-fill" style="width:${(p.xp / p.xpNeeded) * 100}%"></div></div>
    </div>
  `).join('');

  const me = state.players.find((p) => p.id === myId);

  if (me) {
    goldDisplay.textContent = `🪙 ${me.gold}`;
    const ready = me.skillCooldown <= 0;
    skillBtn.disabled = !ready || !me.alive;
    skillBtn.title = ready ? t('skillReady') : Math.ceil(me.skillCooldown / 1000) + 's';
  }

  if (state.merchant && me && me.alive && distanceClient(me.x, me.y, state.merchant.x, state.merchant.y) < 90) {
    merchantPanel.classList.remove('hidden');
    // Rebuild the offer buttons only when their content actually changes (offers bought,
    // or affordability flips) — rebuilding every tick would destroy the button under the
    // cursor 20x/sec and make it nearly impossible to click, like the old upgrade-card bug.
    const signature = state.merchant.offers
      .map((offer) => (offer ? `${offer.id}:${offer.cost}:${me.gold >= offer.cost}` : 'none'))
      .join(',');
    if (merchantOffers.dataset.signature !== signature) {
      merchantOffers.dataset.signature = signature;
      merchantOffers.innerHTML = state.merchant.offers.map((offer, i) => {
        if (!offer) return '';
        const affordable = me.gold >= offer.cost;
        return `<button class="merchant-offer" data-i="${i}" ${affordable ? '' : 'disabled'}>${t('merchantItem_' + offer.id, offer.cost)}</button>`;
      }).join('');
      merchantOffers.querySelectorAll('.merchant-offer').forEach((btn) => {
        btn.addEventListener('click', () => {
          playSfx('click', { volume: 0.4 });
          socket.emit('buyItem', parseInt(btn.dataset.i, 10));
        });
      });
    }
  } else {
    merchantOffers.dataset.signature = '';
    merchantPanel.classList.add('hidden');
  }

  if (me && me.pendingLevelUp) {
    const signature = me.pendingLevelUp.map((u) => u.id).join(',');
    if (upgradeChoices.dataset.signature !== signature) {
      upgradeChoices.dataset.signature = signature;
      upgradeOverlay.classList.remove('hidden');
      upgradeChoices.innerHTML = '';
      for (const u of me.pendingLevelUp) {
        const card = document.createElement('div');
        card.className = 'upgrade-card';
        card.textContent = UPGRADE_TEXT[lang][u.id] || u.label;
        card.addEventListener('click', () => {
          playSfx('click', { volume: 0.4 });
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
  playSfx('gameover', { volume: 0.5 });
  gameOverStats.innerHTML = t('survived', formatTime(state.elapsed)) + '<br/>' +
    state.players.map((p) => t('levelKills', p.name, p.level, p.kills)).join('<br/>');
}
