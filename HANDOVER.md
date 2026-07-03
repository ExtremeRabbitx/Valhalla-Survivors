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
