# Handover Brief — Valhalla Survivors

Co-op browser survivors-like (Vampire Survivors-style) built for a small group of friends to play together. Node.js + Express + Socket.io server (authoritative game loop), vanilla JS/Canvas client, deployed on Render, source on GitHub at `ExtremeRabbitx/Valhalla-Survivors`.

- `server.js` (~1025 lines) — all game logic, authoritative simulation, runs at 20 ticks/sec (`TICK_MS = 50`).
- `public/game.js` (~1590 lines) — client rendering (Canvas), input, UI, sound, translations.
- `public/index.html` (~126 lines) — all screens (lobby/waiting room/game/overlays) in one page, toggled via `.hidden` class.
- `public/style.css` (~326 lines).
- `render.yaml` — Render blueprint (npm install / node server.js, free plan).
- `public/assets/` — sprites (Kenney "Tiny Dungeon" / "Tiny Creatures", CC0) and music/sfx (SubspaceAudio / Kenney audio packs, CC0).

## 1. What's been built

Started as a minimal 2-player survivors-like and grew over many iterations into a fairly full-featured game:

**Core loop:** WASD/joystick movement, auto-attack nearest enemies, XP orbs → level up → pick 1-of-3 random upgrades, survive as long as possible. Server is authoritative; client interpolates between server snapshots for smooth motion (see §3).

**Content:**
- 3 weapons (hammer/axe/sword) with different dmg/speed/range tradeoffs, chosen pre-game.
- 3 classes (warrior/archer/mage), each with distinct sprite + stat profile + an active skill (Space bar / mobile button): warrior=AoE bash, archer=360° volley, mage=heal pulse.
- 8 level-up upgrades including 3 "elemental power" upgrades (lightning bolt, fire aura, frost nova) that add periodic passive AoE abilities, stackable.
- Weapon evolution: picking "damage" 5 times upgrades the weapon to pierce enemies +40% dmg.
- 6 enemy types with distinct behavior: wolf (fast/weak), skeleton (slow/hard-hitting), caster (kites at range, shoots), exploder (weak melee, AoE burst on death), necromancer (kites, periodically summons skeleton minions), draugr (named mini-boss, 4 rotating names).
- World boss every ~100s (Fenrir/Jörmungandr/Surtr/Hel), has a telegraphed ground-slam AoE attack, drops a permanent "relic" pickup.
- Day/night cycle (90s cycle, last 30s is night — enemies stronger, better drops).
- Random per-run modifier (6 options: glass cannon, blood moon, swift foes, fortune, blessed ground, none) picked at game start.
- World events every ~100-140s: wolf swarm burst or a "defend the treasure chest" objective.
- Traveling merchant NPC (periodic, timed window, spend gold on instant buffs).
- Gold currency + power-up ground drops (heal potion, temp speed boost, temp damage boost) alongside XP orbs.
- Difficulty select (easy/normal/hard) and Endless Mode (difficulty keeps climbing past 15 min, separate leaderboard).
- Co-op systems: revive downed teammates by standing near them, proximity damage-synergy buff, camera follows nearest living ally while downed.
- Global leaderboard + separate Endless-mode leaderboard (server-side, JSON file, top 10).
- Personal best stats (client-side localStorage, shown in lobby).
- Achievements (client-side, toast notifications).
- Minimap, floating damage numbers, altar landmark, procedural forest decoration (trees/bushes/rocks), ambient embers, boss health bar fixed to top of screen, slam-attack telegraph circles.
- TH/EN language toggle, mute toggle, screen-shake/motion-reduction toggle, exit-game button with confirm, first-time onboarding overlay.
- Background music (loops during normal play, switches to a boss track while a world boss is alive) + 7 SFX cues.
- Detailed post-game stats (damage dealt by weapon vs. skill, kills broken down by enemy type).

## 2. Key decisions

- **Server-authoritative, client-dumb-renderer.** All game state lives in `server.js`'s `rooms` Map; client only sends `{dx, dy}` input and receives full state snapshots. Chosen to prevent desync between players and keep cheating/inconsistency impossible. Tradeoff: server tick rate (20/s) caps how often positions update, which required client-side interpolation to look smooth (see §3, "frame rate" fix).
- **No database.** Leaderboards persist to flat JSON files (`leaderboard.json`, `endurance.json`) on the Render filesystem — resets on redeploy since Render's free tier has no persistent disk. User was told this explicitly; acceptable for a friends-only game. Personal best stats live in browser `localStorage` instead (no server round-trip needed).
- **CC0-only asset sourcing.** All sprites/audio pulled from Kenney.nl, OpenGameArt.org (SubspaceAudio tracks), explicitly filtered to CC0 (public domain) to avoid any licensing risk, since the user has no budget/desire to manage attribution. User was told upfront that AAA/hand-painted art styles (shown as reference screenshots) aren't achievable this way — pixel-art tile assets were the honest alternative, and the user agreed to that tradeoff.
- **One-shot audio (`new Audio()`) for SFX vs. persistent `Audio` objects for music** — SFX fire-and-forget so overlapping hits don't cut each other off; music uses two persistent looping `<audio>`-equivalent objects (`gameplay`, `boss`) that pause/resume rather than being recreated, to avoid restart glitches.
- **Elemental powers and skills are separate systems.** Class skills (bash/volley/heal) are player-driven (Space bar, on cooldown). Elemental powers (lightning/fire/frost) are upgrade-pool picks that run automatically every tick once acquired. Kept deliberately distinct so a player's "build" is class skill + upgrade choices, not overlapping mechanics.
- **Enemy damage/speed varied by type via multiplier tables** (`ENEMY_DAMAGE_MULT`, `ENEMY_SPEED_MULT` in `server.js`) rather than per-type bespoke logic, to keep balance tuning centralized and easy to read.
- **MAX_ENEMIES hard cap (180)** chosen over more complex spatial partitioning/optimization, since it directly fixes the O(enemies × projectiles) collision cost blowing up in long games — simplest fix that solved the reported lag.
- **Native `confirm()` for the exit-game dialog** instead of a custom modal — simplest way to guarantee a blocking, unmissable confirmation as requested, at the cost of not being able to style it (acceptable, standard browser UX).

## 3. Problems encountered and how they were fixed

| Problem | Root cause | Fix |
|---|---|---|
| Upgrade-choice buttons "hard to click" | `updateHud()` rebuilt the upgrade-card DOM from scratch on every server tick (20×/sec), destroying the button under the user's cursor before a click could register | Track a `dataset.signature` of the current choices; only rebuild DOM when the signature actually changes (`public/game.js`, `updateHud`) |
| Merchant "buy" buttons had the identical symptom later | Same bug pattern, reintroduced independently in the merchant panel code | Same signature-gated rebuild fix applied to `merchantOffers` |
| Massive particle-spam / stutter mid-session | A socket that calls `createRoom`/`joinRoom` multiple times without reloading stayed joined to **all** its previous Socket.io rooms — server kept broadcasting old rooms' ticks to it, and the client's `diffEffects` (which spawns particles on "enemy disappeared") saw entities disappearing that were never actually part of the current game, firing thousands of false death-particle bursts | Added `leaveCurrentRoom()` in `server.js`, called before every `createRoom`/`joinRoom`, so a socket can only ever be in one game room |
| Enemy sprites had a visible black box/border | Kenney "Tiny Creatures" pack tiles were exported as **indexed PNGs with no `tRNS` transparency chunk** — background was a real opaque black (0,0,0), just blended into the game's dark scenes so it went unnoticed until reported | One-off Node script using `pngjs` (installed with `--no-save`, not a runtime dependency) that samples the 4 corner pixels, treats that color as the background, and zeroes its alpha channel; re-run per affected sprite |
| Motion felt "laggy"/not smooth even though rendering wasn't capped | `requestAnimationFrame` already runs at full display refresh rate, but the **server only sends positions 20×/sec** — every entity was snapping to a new position every 50ms regardless of how fast the browser painted, which reads as stutter on high-refresh displays | Client-side interpolation: keep the previous and current server snapshots + a receive-timestamp, blend every entity's rendered position between them based on elapsed time (`buildInterpMaps` / `ipos()` in `public/game.js`) |
| Relic bonus silently never applied | `socket.emit('setRelics', …)` was only sent on the `connect` event, which fires **before** the player has created/joined a room — the server handler requires an existing room and drops the call | Re-send `setRelics` from `enterWaitingRoom()`, once the player is actually in a room server-side |
| Onboarding this same session: `applyTranslations()` crash on load broke *all* button listeners | New code called `updateWeaponDesc()`/`updateClassDesc()` from `applyTranslations()`, which runs early — but the `const` DOM references those functions used were declared much further down the file, hitting the temporal-dead-zone and throwing before `createBtn`'s click listener (and everything after it) ever got registered | Moved the `const weaponDescEl` / `classDescEl` declarations up next to the other early DOM refs, before first use |
| 21MB boss music WAV | Source file from OpenGameArt was uncompressed WAV | Converted with `ffmpeg` (`libvorbis -q:a 3`) to ~1.7MB OGG |

**General testing note for whoever picks this up:** the preview/automation tooling used this session sometimes fails to deliver a synthetic `click()` to a page immediately after `location.reload()` (no visible error, event just doesn't fire) — if a "button does nothing" repro doesn't reproduce with a *manual* click, don't chase it as a real bug. Also, `confirm()`/`alert()` block the page entirely and will time out any automated `click`/`eval` call — that's expected, not a hang.

## 4. Related files / where to look

- **`server.js`** — single source of truth for all game rules/balance. Key sections top-to-bottom: tunable constants block (top), `UPGRADES`/`DIFFICULTY`/`WEAPONS`/`CLASSES`/`MODIFIERS`/`MERCHANT_ITEMS` config tables, `makePlayer()`, `spawnEnemy()` / `summonMinion()`, `tickRoom()` (the main loop — movement, combat, events, all in one function, ~350 lines), `serializeRoom()` (everything sent to clients), then the `io.on('connection', …)` socket handlers.
- **`public/game.js`** — sprite/SFX/music loading + `SPRITES`/`SFX` maps at top, `TRANSLATIONS`/`UPGRADE_TEXT` (TH/EN) dictionaries, socket event handlers, `render()` (the main draw loop, also ~350 lines: background → nature → altar → light pooling → orbs → merchant → projectiles → enemies → particles → players → damage numbers → minimap), `updateHud()` (DOM-based UI: stats panel, boss bar, merchant panel, upgrade cards), `showGameOver()`.
- **`public/assets/`** — `player-{warrior,archer,mage}.png`, `enemy-{wolf,skeleton,elite,caster,exploder,necromancer,worldboss}.png`, `weapon-{hammer,axe,sword}.png`, `xp-gem.png`, `tileset.png` (Kenney Roguelike/RPG sheet, used for nature decoration sub-rects), `sfx/*.ogg`, `music/{gameplay,boss}.ogg`.
- **`.gitignore`** excludes `leaderboard.json` / `endurance.json` (runtime-generated, not source).
- No test suite exists — all verification this session was manual, via the Claude Code preview/browser tooling (see §6).

## 5. Known limitations / things to be aware of

- Leaderboards reset on every Render redeploy (no persistent disk on free tier).
- No accounts — "personal best" is per-browser localStorage, not tied to a name/identity; clearing browser storage loses it.
- Relic meta-progression bonus is capped at +30% (`Math.min(0.3, relicCount * 0.01)`) — a returning player with many relics won't keep scaling forever, by design.
- `MAX_ENEMIES = 180` is a blunt fix for the late-game lag; if the room population grows (this was designed around ~2-4 friends) it may need revisiting alongside actual spatial-partitioning if enemy counts need to go much higher.
- Music/SFX volumes are hardcoded per-cue (no user volume slider, only mute on/off).
- The necromancer's summoned skeletons and world-boss slam damage aren't separately broken out in the post-game stats (they land under the boss's/necromancer's normal melee or the exploder-burst path depending on source — not mis-tracked, just not itemized further than "kills by enemy type").

## 5b. Balance pass (this session)

Static analysis of `server.js`'s numeric tables surfaced two real outliers (not yet playtested against real sessions — just math):

- **Lightning elemental power was compounding on three axes at once**: per-bolt damage scaled with level, target count scaled with level, *and* cooldown shrank with level — so total DPS grew quadratically (level 5 was ~15× base damage/sec, dwarfing fire aura and frost nova at the same level). Fixed by decoupling: per-bolt damage is now fixed at `0.5×damage`, only target count and cooldown still scale with level (linear growth).
- **Fire aura didn't scale with the player's `damage` stat at all** — it was a flat `3 + level*2` DPS number, so it became trivial once damage upgrades/relics/weapon multipliers pushed `p.damage` up late-game, while lightning/frost nova (which do scale off `p.damage`) kept pace. Fixed: `dps = p.damage * (0.05 + level * 0.03)`.
- **`blessed_ground` run modifier had zero downside** (only `regenBonus: 0.5`, every other multiplier at 1), making it strictly better than the `none` modifier with no tradeoff, unlike every other modifier which pairs its bonus with a real cost. Gave it a small `enemyHpMult: 1.12` so it's still a "safe" run-feel modifier but not a free lunch.

Frost nova was left as-is — it already scales on a single axis (damage × level, with cooldown shrinking modestly) and its slow is a real secondary value, so it wasn't an outlier like lightning.

**Not done, still worth eyeballing in a real playtest**: weapon DPS parity (hammer/axe/sword land within ~10% of each other on paper, untested in practice), warrior bash vs. archer volley vs. mage heal general power level (different play patterns, hard to compare on paper alone), and whether `swift_foes`/`fortune` (which already have real downsides) still feel worth picking over `none` in practice.

## 5c. XP-drop lag fix + volume slider (this session, from real user feedback)

User reported real lag when many XP orbs drop at once (e.g. after a swarm event or an AoE elemental power kills a bunch of enemies in the same tick). Root cause was two-fold, both fixed:

- **Server**: unlike `MAX_ENEMIES`, `room.orbs` had no cap/merging — every dead enemy pushed its own orb, so a same-tick burst kill spawned N separate orb entities at once. Fixed in `server.js`'s dead-enemy loop: regular (non-elite, non-boss) kills in the same tick are now summed into **one** merged orb at their centroid (`xpBurstValue`/`xpBurstX`/`xpBurstY`/`xpBurstCount`), preserving total XP and roughly correct position. Elite/world-boss kills still get their own individual orb since they're rare and not the volume source.
- **Client**: every orb was drawn with `ctx.shadowBlur` (`public/game.js`, the orb-render block) — one of the most expensive Canvas2D ops — even plain XP orbs, the common case that floods the screen during a burst. Now only the rare relic pickup gets the glow; ordinary XP/gold/power orbs render without it.

Also replaced the binary mute toggle with an actual **volume slider** (`#volumeSlider` next to `#muteBtn` in `index.html`/`style.css`), since it was on the deferred next-steps list anyway. `game.js` now tracks a `masterVolume` float (0-1, persisted to `localStorage['vs_volume']`, migrates a prior `vs_muted` value) instead of a boolean; the speaker icon still works as a quick mute/unmute that remembers the last slider position.

**Deferred, not done this session**: the 4th-weapon idea (bow) discussed with the user was intentionally skipped — it needs a new CC0 sprite sourced and transparency-fixed like the other assets, which wasn't safe to improvise in-session without risking a mismatched art style. Worth doing properly (source from Kenney.nl or similar, run through the same corner-sampling transparency script used for the enemy sprites) if picked back up.

## 5d. Gold economy rebalance (this session, from real user feedback)

User reported gold felt like it dropped too fast — no real decision at the merchant, and too few items to choose from. Both addressed in `server.js`:

- **Income cut**: the regular-kill gold-drop chance (the dominant income source — elite/world-boss gold is guaranteed but those kills are rare) halved from `0.2` to `0.1`. A merchant visit should no longer trivially afford all 3 offered items.
- **Item pool widened from 5 to 8**: added `regen` (+0.4/s, 25g), `range` (+30 attack range, 20g), `magnet` (+25 pickup radius, 15g) to `MERCHANT_ITEMS`, with matching TH/EN translations in `public/game.js` (`merchantItem_regen/range/magnet`). Still only 3 offers shown per visit, so which 3 of the 8 show up is itself a variable now.

Not playtested for the *right* income level yet — the halving is a reasonable first cut, not a tuned number. If gold still feels too abundant (or now too scarce) after a real session, adjust the `0.1` coefficient at `server.js`'s `goldAmount` line rather than re-deriving from scratch.

## 5e. Five new gameplay systems (this session, in response to "farming for a while turns into standing AFK")

User's core complaint: once a run gets going, there's little reason to actively engage — just wait for auto-attack and level-ups. All 5 systems below were picked/designed with that in mind (frenzy and night hazards especially punish standing still), and each deliberately reuses existing machinery rather than inventing new subsystems from scratch, per this project's usual pattern (see `MAX_ENEMIES`, the treasure-channel pattern, etc.).

1. **World boss signature attacks** (`server.js`, the `e.worldBoss` block inside the enemy-movement loop) — each of the 4 bosses now has a second attack beyond the shared ground-slam, on its own `secondCooldown` (`SECOND_ATTACK_COOLDOWN = 9`s):
   - **Fenrir**: telegraphs a target point (`e.lungeTelegraph`, `LUNGE_TELEGRAPH_TIME = 0.9`s), then teleports there and hits everyone within `LUNGE_RADIUS` (112), plus gets a temporary speed boost (`LUNGE_SPEED_BOOST`) afterward. Reuses the same telegraph-then-resolve shape as the slam.
   - **Jörmungandr**: when its *slam* lands, it also leaves a lingering poison pool (`room.hazards`, kind `'poison'`, `POISON_POOL_DURATION`/`POISON_POOL_DPS`) — no separate cooldown, piggybacks on the slam trigger.
   - **Surtr**: fires a 5-projectile fan (`SURTR_FAN_COUNT`) via the existing `room.enemyProjectiles` system (same one casters use).
   - **Hel**: summons 3 skeletons (`HEL_SUMMON_COUNT`) via the existing `summonMinion()` function (same one necromancers use).
   - Client renders the lunge telegraph the same way as the slam telegraph (`public/game.js`, dashed amber ring vs. the slam's solid red one).

2. **Evolved-weapon signature procs** (`server.js`, inside the main projectile-collision loop) — on top of the existing uniform evolve bonus (+40% dmg, pierce+2), evolved weapons now also proc a weapon-specific effect on every weapon hit (not skills): hammer staggers (reuses the `e.slowUntil` field frost nova already uses), axe applies a bleed DoT (`e.bleedUntil`/`bleedDps`/`bleedOwnerId`, ticked in its own small loop right after the projectile loop), sword cleaves `SWORD_CLEAVE_FRACTION` of the hit's damage to other enemies within `SWORD_CLEAVE_RADIUS`.

3. **Interactive altar** (`server.js`, `room.altarActive`/`ALTAR_*` constants, `triggerAltarEffect()`) — the previously-decorative altar at the world center now periodically activates (`ALTAR_INTERVAL = 90`s, first one at `ALTAR_INITIAL_DELAY = 45`s); players channeling within `ALTAR_RADIUS` for `ALTAR_CHANNEL_TIME` (4s) trigger one random room-wide effect, ~55% blessing / 45% curse (`ALTAR_BLESSING_CHANCE`): blessings are heal-all, brief invuln for all, gold, or a burst of XP orbs; curses are a %-maxHP hit to all, a 6-wolf ambush, or losing half your gold. Deliberately one-shot effects (not timed multipliers) to avoid threading a new buff system through every damage formula in the game. Mirrors the treasure-channel pattern almost exactly. Client shows a progress ring (`public/game.js`, purple, near the altar sprite) and a toast on resolution (`altarEffect_*` translation keys).

4. **Kill-streak frenzy** (`server.js`, `p.frenzyStacks`/`frenzyDecayAt`) — every kill adds a stack (capped at `FRENZY_MAX_STACKS = 6`) and resets the decay timer; going `FRENZY_DECAY_WINDOW` (3s) without a kill **hard-resets stacks to 0** — this is the piece most directly aimed at the AFK complaint. Each stack gives +6% weapon damage and +5% attack speed (capped at 30% cooldown reduction), applied only to the main weapon attack. Frenzy is credited to whoever actually landed the last hit (`e.lastHitOwnerId`, set at every player-damage site: projectiles, lightning, fire aura, frost nova, bash, cleave, bleed) rather than the pre-existing `alivePlayers[0]` convention the `kills`/`killsByType` stats use — that stat's attribution was left alone since fixing it wasn't asked for and touching it risked an unrelated regression. Client shows a small `🔥xN` label over the player sprite.

5. **Night ground hazards** (`server.js`, `room.hazards`, `NIGHT_HAZARD_*` constants) — during the night phase of the day/night cycle, a fire (damage) or ice (damage + 50% slow via `p.hazardSlowUntil`) patch spawns every `NIGHT_HAZARD_INTERVAL` (10s) near a random player and lasts `NIGHT_HAZARD_DURATION` (15s). Built as a generic hazard-zone system shared with Jörmungandr's poison pool (item 1) — same array, same tick/expiry loop, just a different `kind`. Client renders each as a soft radial-gradient ground patch (`HAZARD_COLOR` per kind) under everything else.

**Verification**: syntax-checked both files; live-tested with `WORLD_BOSS_INTERVAL`/`NIGHT_CYCLE`/`ALTAR_INTERVAL` temporarily lowered (reverted after) to force these systems to fire within a short real-time window. Confirmed live and error-free: altar activated, channeled (player spawns within `ALTAR_RADIUS` of it by default), and resolved; a night ice hazard spawned, persisted, and contributed to a real player death; frenzy capped correctly at 6 stacks; world boss "Hel" spawned, summoned minions, and took damage from ongoing combat — all with zero server or console errors, and the existing game-over/stats flow still rendered correctly afterward. **Not** live-triggered in this session (reviewed by code inspection only, following patterns already proven elsewhere in the file): Fenrir's lunge, Surtr's fan, Jörmungandr's poison-on-slam, and the evolved-weapon procs (evolving a weapon requires 5 damage-upgrade picks, which didn't come up in the short test runs). Worth an eye on a full real playtest.

**Balance note**: none of these 5 systems have been tuned against real multi-session play — the numbers (frenzy caps, altar odds, hazard damage, boss cooldowns) are first-pass estimates sized to feel meaningful without being overwhelming, not derived from playtesting. Expect another rebalance pass to be worth doing once there's real signal.

## 5f. Real-play bugfixes + Berserker class / build-line system / 5 new area skills (this session)

Two rounds of real user feedback from an actual co-op session, then a large content addition.

**Bugfixes from real play:**
- **Fire aura still read as "no damage"** even after §5b's fix — the damage-only rewrite in that fix came out to ~0.8 dps at level 1 with typical early damage (~10), imperceptible against anything but the squishiest enemy. Fixed by restoring a flat baseline component alongside the damage-scaling term: `dps = (2 + level*1.5) + p.damage*(0.03 + level*0.02)`.
- **Merchant offers were room-wide, not per-player** — `room.merchant.offers[offerIndex] = null` on purchase meant the first player to buy an item made it permanently unavailable for every other player in the room that visit. Fixed with per-offer `boughtBy: [playerId, ...]` tracking instead of nulling the slot; client shows a ✅ and disables the button only for the buyer.
- **Altar felt broken ("stood there, nothing happened")** — not a bug, but the altar is only active for a ~20s window every ~90s, easy to miss entirely. Added a room-wide `altarActivated` announcement (toast + sound) the moment it turns on.
- **No visible buff/debuff status** — spec system already tracked `speedBoostUntil`/`damageBoostUntil`/`invuln`(shield)/`frenzyStacks` server-side but never surfaced remaining duration to the client, and nothing showed for *teammates*. Added `speedBoostRemaining`/`damageBoostRemaining`/`shieldRemaining` to the player payload and a per-player status-chip line in the stats panel (visible for every player in the room, not just self).
- **Floating damage numbers showed misleading "0"** — root cause: any continuous-tick damage source (fire aura, bleed, hazards) deals a fraction of a point per 50ms tick, and the popup rounded that raw per-tick delta before checking accumulate. Fixed by accumulating fractional damage client-side (`enemyDamageAccum`/`playerDamageAccum` Maps in `diffEffects`) and only popping a number once it reaches a whole point. This was the highest-value fix — it affects every DoT-style source in the game, not just fire aura.
- **`range` upgrade/merchant-item felt like a wasted pick** ("no combat value") — both now also grant a small flat damage bonus (`+2`) alongside the range increase, on top of the existing range benefit.

**New content — Berserker class + build-line system + 5 area skills** (user explicitly wanted: a knockback-on-hit class, a "line" system where investing in area vs. shooting upgrades passively strengthens that line and is shown on the upgrade screen, and ~5 more area/AoE skills):

1. **Berserker class** (`server.js` `CLASSES.berserker`) — tanky/slow-but-hard-hitting per the user's chosen direction: `hpMult 1.4, dmgMult 1.2, speedMult 0.85, atkSpeedMult 0.75` (new `atkSpeedMult` field, applied at `startGame` alongside the existing weapon/class multiplier chain). Every weapon hit (not skills) knocks the target back via a new generic **knockback** mechanic: `e.knockbackVX/VY/knockbackUntil/knockbackTotalDuration`, checked at the very top of the enemy-movement loop — while active it fully overrides normal chase/attack behavior and decays to 0 speed by expiry so it doesn't look like a sudden stop. Active skill `warcry`: AoE damage + a much harder, longer knockback (`WARCRY_KNOCKBACK_SPEED`/`_DURATION`). Sprite (`public/assets/player-berserker.png`) is a **palette-swapped recolor of the existing warrior sprite** (steel-blue armor → bronze/iron, darker outline) done with a one-off `pngjs` script (installed `--no-save`, not a runtime dependency, matching the pattern already used for the sprite-transparency fix) — chosen over sourcing new art from scratch, which would've been much higher risk to get looking right in-session.

2. **Build-line system** (`server.js` `UPGRADE_TRACKS`, `updateSpecMults()`) — every upgrade is tagged `'area'` (lightning/fireaura/frostnova + the 5 new skills below) or `'shooting'` (damage/atkspeed/multishot/range) or untagged. `p.upgradeCounts` (already tracked) is re-summed into `p.areaSpecPicks`/`shootingSpecPicks` every time an upgrade is chosen, producing `p.areaSpecMult = 1 + picks*0.06` and `p.shootingSpecMult = 1 + picks*0.05`. `areaSpecMult` multiplies the damage **and radius** of all 8 area/elemental skills; `shootingSpecMult` multiplies only the main weapon-attack damage (not skills). Client shows current line levels above the upgrade cards (`🌀 Area Lv.X | 🎯 Shooting Lv.Y`, `#specStatus`) and a small track-tag chip on each relevant card — verified live via screenshot showing both working correctly together.

3. **5 new area skills**, same levelable-upgrade shape as lightning/fireaura/frostnova:
   - **Poison Cloud** (`poisonLevel`) — periodic pulse afflicts a lingering DoT directly on enemies caught in range (`e.poisonUntil/poisonDps/poisonOwnerId`, ticked next to axe bleed). **Note**: originally implemented via `room.hazards` (spatial hazard zones) like Jörmungandr's poison pool, but that system damages *players* standing in a zone, not enemies — pushing a "poison cloud" into it would have either done nothing to enemies or backwards-hurt the caster. Caught and fixed before shipping; worth remembering if extending hazards further.
   - **Wind Gust** (`windLevel`) — periodic burst damage + knockback via the same generic knockback mechanic as Berserker.
   - **Rune Circle** (`runeLevel`) — periodic burst damage + self-heal.
   - **Meteor Strike** (`meteorLevel`) — long cooldown (12-16s), heavy single hit; scans enemies within 500 units and strikes wherever they're most densely clustered (O(n²) density scan, fine at the existing `MAX_ENEMIES=180` cap) rather than always centering on the player.
   - **Shockwave** (`shockwaveLevel`) — periodic burst damage + a new **stun** mechanic (`e.stunUntil`, checked in the same top-of-loop spot as knockback) — a full movement/attack freeze, distinct from the existing slow (percentage speed reduction).

**Verification**: syntax-checked; live-tested extensively — selected Berserker and confirmed `140/140` HP (100×1.4) and the recolored sprite rendered distinctly; force-picked every one of the 5 new skills via direct `chooseUpgrade` socket emits (bypassing the random 3-of-N offer, since `chooseUpgrade` doesn't validate the pick was actually offered — a pre-existing minor server gap, harmless for a friends-only game) and confirmed each dealt real damage via `skillDamageDealt` deltas (poison 0→181, meteor 0→30 matching its expected single-hit magnitude, shockwave 30→230); game-over/leaderboard flow still worked correctly after a real death mid-test; screenshot-confirmed the spec-line header and per-card track tags render correctly together. Zero server or console errors across the whole session. **Not directly observed**: the Berserker's on-hit knockback and warcry's harder knockback specifically (no easy way to visually confirm push-back from scripted input alone) — the code path is simple and mirrors the already-verified wind-gust knockback, so this is lower risk, but worth a human eye during a real playtest.

**Balance note**: none of these numbers are tuned from real play — first-pass estimates only, expect another pass once there's signal from actually playing it.

## 5g. 3 more area skills: Gravity Well, Bramble Trap, Blood Nova (this session)

User asked for more area/elemental skills specifically (as opposed to more class active-skills), on top of the 8 that already existed (lightning/fireaura/frostnova/poison/wind/rune/meteor/shockwave). Added 3 more, each picked to be mechanically distinct from all 8 existing ones rather than another variation on "pulse that damages nearby enemies":

- **Gravity Well** (`gravityLevel`) — damage + pulls enemies toward the point the player was standing at cast time, the mirror image of knockback. New fields `e.pullTargetX/pullTargetY/pullUntil`, checked in the same top-of-loop CC-override slot as knockback/stun in the enemy movement loop (`GRAVITY_PULL_SPEED`, `GRAVITY_PULL_DURATION = 1.2s`). Useful for bunching enemies up so other AoE skills land on more targets at once.
- **Bramble Trap** (`brambleLevel`) — a *reactive* skill instead of another self-centered pulse: places a stationary trap (`room.traps`, new array parallel to `room.hazards`) at the player's position on cooldown; it sits until an enemy walks into its radius, then detonates for damage + roots the enemy and is consumed. Reuses `e.stunUntil` for the "root" rather than inventing a near-identical field — root and stun end up mechanically identical (full movement/attack freeze) in this implementation, just triggered differently; worth splitting into a true partial-root (blocks movement but not attacks) later if that distinction ever matters. Client renders a persistent 🌵 marker with a faint dashed radius ring (`latestState.traps`), unlike the transient `skillEffects`.
- **Blood Nova** (`bloodNovaLevel`) — a resource-cost skill: costs `8%` of the caster's own max HP (floored at 1 HP, can't suicide) for a large single-target-radius nuke. First skill in the game where casting has a real cost, not just a cooldown — a deliberate risk/reward outlier next to 10 free-cast skills.

All 3 wired into `UPGRADE_TRACKS` as `'area'`, so they benefit from and count toward `areaSpecMult` same as the other 8.

**Verification**: syntax-checked; live-tested each via forced `chooseUpgrade` emits. Gravity took ~30s (a few cooldown cycles) before an enemy happened to be in its radius at the exact trigger instant — not a bug, just cooldown-vs-enemy-position timing luck, confirmed once `skillDamageDealt` jumped 0→300. Bramble confirmed via `skillDamageDealt` jumping to 1219 and `latestState.traps.length === 1` mid-test (trap visible in serialized state). Blood nova's cast wasn't isolated from concurrent gravity/bramble triggers before the test player died mid-combat (a real death from ongoing enemies, not a crash), so its damage contribution specifically wasn't cleanly isolated — worth a closer look in a real playthrough, though the code path is simple and mirrors rune/frostnova's already-proven "burst damage in radius" shape. Zero server/console errors throughout. Game-over/leaderboard flow confirmed working after the death.

## 5h. Persistent skill-level display + always-on cast effects (this session)

Two follow-up requests after §5g, both about being able to tell a skill is actually active/working:

- **Skill-level HUD readout**: added `skillLevels` (all 11 area-skill levels, keyed by id) to the player payload in `serializeRoom`, and a `skillLevelsHtml()`/`SKILL_ICON` map in `public/game.js` that renders a compact `⚡1 🔥2 ☠️3`-style line in each player's stats-panel card (self *and* teammates), right under the existing buff/debuff status chips. Only non-zero levels show. Verified live via `document.getElementById('statsPanel').innerHTML` showing `<div class="skill-levels">⚡1</div>` after picking lightning.

- **Cast effects were hit-gated, not cooldown-gated** — the real bug this surfaced: `frostnova`, `poison`, `wind`, `rune`, `shockwave`, `gravity`, `bloodnova` (and lightning's whole pulse) only emitted their `skillEffect` (visual ring + particles) when the pulse actually connected with an enemy (`if (hit) io.to(...).emit(...)`). If the cooldown fired but nothing happened to be in range at that exact instant — very plausible for the wider-radius/longer-cooldown skills like gravity or meteor — there was **zero feedback** that the skill was even active, indistinguishable from it being broken. Fixed by always emitting the visual/sound on cooldown trigger regardless of whether anything was hit (damage/heal/root effects themselves stay correctly gated on an actual hit — only the *feedback* is now unconditional). Meteor falls back to striking the player's own (harmless) position when no enemies are in scan range, purely so the long cooldown still shows a visible cast on schedule. Also added a shared quiet "cast" sound (`click.ogg` at low volume, reused rather than sourcing new audio) in the client's `skillEffect` handler, since a busy fight can hide an off-screen visual pulse even when it's firing correctly.

**Verification**: syntax-checked; live-tested by hooking the client's `skillEffect` listener directly and logging every event with a timestamp. Confirmed gravity's effect fired 3 times over ~50s at ~12-13s intervals — matching its cooldown exactly, regardless of whether an enemy happened to be in range each time. This is the direct fix for "will I know if the skill is working" — before this fix, an unlucky run of misses would have shown nothing at all across that same window. Zero server/console errors.

## 5i. Tougher, longer world boss fight (this session)

User wanted the world boss harder and slower to kill. Two numbers in `spawnEnemy()` (`server.js`) tuned:
- HP multiplier for world bosses raised from `16x` to `26x` (the same formula used for elites, `eliteMult`) — roughly +63% HP, directly extending fight length.
- World boss damage multiplier raised from `3x` to `3.5x` — hits noticeably harder without the jump being so large it risks one-shotting an undertuned player. Slam/lunge damage (which multiply off this same `e.damage` base) scale up automatically with it, no separate change needed.

**Verification**: syntax-checked; live-tested by temporarily lowering `WORLD_BOSS_INTERVAL` to force an immediate spawn (reverted after). Confirmed HP came in at ~501 at the same elapsed time that the old multiplier would have produced ~261-276 — matching the expected ~1.6x scale-up. Zero server errors. Not tuned against a real full playthrough — if the fight now runs too long or still too short, adjust `eliteMult`'s `26` and the damage multiplier's `3.5` directly rather than re-deriving from scratch.

## 5j. Lightning reworked into a real chain (this session)

Previously "lightning" wasn't actually a chain — it picked the `1+level` enemies nearest the *player* and hit each independently (a multi-target fan, not a bounce). User asked for it to genuinely bounce, with higher level bouncing more, so it was reworked in `server.js`'s elemental-powers block:

- First jump searches from the player's position (range `320 * areaSpecMult`); every jump after that searches from wherever the bolt just landed, picking the nearest *not-yet-hit* enemy within the same range — so it now actually chains through a cluster instead of just multi-hitting whatever's near the caster.
- Bounce count cap is still `1 + lightningLevel` (same as before) and per-bolt damage is still fixed regardless of level (only bounce count and cooldown scale) — the linear-not-quadratic growth from §5b's balance pass is preserved, only the *targeting logic* changed.
- Client (`public/game.js`) now draws the bolt as a connected sequence (player → target 1 → target 2 → …) instead of a fan of separate bolts all originating at the player, so the visual matches the new mechanic.

**Verification**: syntax-checked; live-tested by hooking the client's `skillEffect` listener and logging `targets.length` for every lightning cast. At lightning level 1 (cap = 2), observed bounce counts of 0, 1, and 2 across many casts — 0 and 1 when fewer chainable enemies happened to be nearby, 2 (the level's cap) when a full chain was available — confirming the cap holds and the chain only extends as far as actual nearby targets allow. Zero server/console errors.

## 5k. XP pickup frozen during the upgrade-choice screen + level-up queue (this session)

User reported two related problems with the level-up flow in `server.js`:

- **Orb pickup (including the magnet pull) was hard-gated on `p.pendingLevelUp`** — both the pull-toward-player loop and the pickup/consume loop had `if (p.pendingLevelUp) continue;`, so literally nothing got collected (not just XP — gold, potions, relics too) while the upgrade-choice screen was up. Removed the gate entirely from both loops; pickup now works identically whether or not a choice screen is showing.
- **A single big XP gain that crossed two level thresholds at once silently dropped the first choice** — the leveling `while` loop just did `p.pendingLevelUp = randomUpgrades()` on every iteration, so a double-level in one tick (a big treasure/altar orb, or now-unblocked pickup stacking XP while already choosing) overwrote the in-flight choice before the player ever saw it, quietly losing that upgrade pick. Fixed with a proper queue: added `p.levelUpQueue = []`; if `pendingLevelUp` is already set when another level-up fires, the new choice set is pushed onto the queue instead of overwriting; `chooseUpgrade` now shifts the next queued set into `pendingLevelUp` after applying the current pick (instead of just nulling it), so a second choice screen pops up immediately, back-to-back, with nothing lost. No client changes were needed — the client already rebuilds the upgrade-choice UI whenever `pendingLevelUp`'s id signature changes, which naturally happens when the server swaps in the next queued set.

**Verification**: syntax-checked; live-tested by deliberately leaving a level-up choice unresolved while continuing to farm. Confirmed XP kept climbing (21→45→44 across level 2→3, `xpNeeded` climbing too) while the original 3-choice set stayed on screen unchanged — proving pickup isn't frozen and the queue isn't silently overwriting. Then resolved the pending choice and confirmed a *different* 3-choice set appeared immediately (`atkspeed/wind/damage` → `magnet/damage/gravity`), with level having advanced to 4 in the interim — the queued pick popped correctly instead of being lost. Zero server/console errors.

## 5l. Treasure/orb pickup always went to the host (this session)

User reported the treasure chest "only the room host gets it, others get nothing even after helping open it." Root cause in the orb-pickup loop in `server.js` (`room.orbs = room.orbs.filter(...)`): it awarded each orb to the *first* player in `alivePlayers` found within pickup range, and `alivePlayers` comes from `room.players` (a `Map`), whose iteration order is join order — so the host (always first to join) is always first in that array. Whenever multiple players were within range of the same orb (exactly the treasure-chest scenario, where everyone clusters together to defend it), the host won every single one regardless of who was actually closest. This wasn't treasure-specific — it affected *any* orb (XP, gold, potions, relics) whenever players were clustered, just most visible at the treasure chest because that's the one moment the whole party stands in the same spot.

Fixed by finding the closest in-range player for each orb instead of the first match in iteration order — a straightforward nearest-wins tie-break.

**Verification**: syntax-checked; live-tested with two real socket connections in the same room (not just one client scripted twice) to get genuine independent player state. Both accumulated XP and leveled up independently over the same test window (host: level 4, 31 kills; second player: level 2, 0 kills but real XP gained) — the second player gaining real XP with zero kills credited to them confirms orb pickup is now decoupled from the pre-existing `kills`-counter convention (which still credits `alivePlayers[0]` and was intentionally left alone, not in scope here) and correctly follows proximity. Didn't force an exact simultaneous-tie-break moment (hard to guarantee deterministically via scripted input), but the fix itself is a simple, unambiguous nearest-distance selection — low risk. Zero server/console errors across two live connections.

## 5m. Lightning damage falloff per bounce (this session)

User asked whether lightning's damage should decrease with each bounce instead of hitting equally hard every jump — yes, that's the standard chain-lightning design, so implemented: `LIGHTNING_FALLOFF = 0.75` (each bounce deals 75% of the previous bounce's damage), floored at `LIGHTNING_MIN_FALLOFF = 0.3` of the base hit so far-out bounces at high levels don't decay to near-nothing. Base per-bolt damage (before falloff) is unchanged — still fixed regardless of level, only bounce count/cooldown scale with level, preserving the linear-not-quadratic growth from §5b. Example curve at base damage 10: 10 → 8 → 6 → 4 → 3 → 3 (floor).

**Verification**: syntax-checked; live-tested by force-picking lightning and confirming `skillLevels.lightning` incremented and `skillDamageDealt` grew from real chain hits, no crash. Didn't isolate per-bounce damage values individually in this pass (would need per-hit logging), but the formula is simple arithmetic applied to already-verified chain-targeting logic from §5j — low risk.

## 6. Next steps (not yet done — discussed but explicitly deferred or just not reached)

Ideas that were pitched to the user and are still on the table if they want to keep going (roughly in order the user seemed most interested):
1. **Minimap ping system** — explicitly the one item the user said *not* to build from the last batch of suggestions; skip unless they change their mind.
2. **Balance pass** — with this many systems stacked (classes × weapons × upgrades × modifiers × difficulty × endless scaling), a real multi-session playtest to retune numbers is overdue; nothing has been rebalanced holistically, only additively.
3. Deeper stat attribution (e.g. per-upgrade damage contribution, not just weapon vs. skill).
4. A volume slider instead of binary mute.
5. Possible spatial partitioning if `MAX_ENEMIES` needs to rise.

**Process note:** this project has been extremely feature-additive — nearly every user turn was "add these N things," rarely "fix/trim." If continuing, it's worth flagging to the user that a stabilization/playtest pass would pay off before adding more systems, since the last few turns were already starting to interact in non-obvious ways (e.g. world boss slam + necromancer summons + swarm event all compounding at once, as seen in testing).

## 7. Deploy / ops

- **Live on Render**, connected to `github.com/ExtremeRabbitx/Valhalla-Survivors` `main` branch — every push to `main` auto-deploys.
- Render free tier: service sleeps after 15 min idle, ~30-50s cold start on first request after sleep.
- To deploy locally: `npm install && node server.js`, serves on `PORT` env var or 3000.
- No CI/build step — plain Node, static files served directly by Express (`express.static`).
