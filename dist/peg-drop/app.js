// peg-drop v7 VS — えすけーぷがめ vs (左右盤面・相性システム・敵AI)
// 玉を選んで落とす → ペグの色と相性ならば 破壊/分裂 → 早く相手 HP 0 にしたら勝ち

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
// High-quality smoothing for sharp edges on big peg/cannon images that get
// downscaled to small render sizes.
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
// Match the device pixel ratio so canvas doesn't render blurry on Retina.
const DPR = window.devicePixelRatio || 1;
if (DPR > 1) {
  const cw = canvas.width, ch = canvas.height;
  canvas.width = cw * DPR;
  canvas.height = ch * DPR;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  ctx.scale(DPR, DPR);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}
const enemyImg = document.querySelector('#enemy-img');
const enemySlot = enemyImg.parentElement;
const mascotImg = document.querySelector('#mascot-img');
const mascotSlot = mascotImg.parentElement;
const playerHpFill = document.querySelector('#player-hp-fill');
const enemyHpFill = document.querySelector('#enemy-hp-fill');
const playerHpText = document.querySelector('#player-hp-text');
const enemyHpText = document.querySelector('#enemy-hp-text');
const stageEl = document.querySelector('#stage-num');
const dialog = document.querySelector('#dialog');
const resultTag = document.querySelector('#result-tag');
const resultTitle = document.querySelector('#result-title');
const resultText = document.querySelector('#result-text');
const overlayEl = document.querySelector('#stage-overlay');

// Canvas: 480 wide, 540 tall — vertically compressed so the full HUD + VS +
// arena + hint row fit inside one viewport without scrolling.
const CANVAS_W = 480, CANVAS_H = 720;
const BOARD_W = 220, BOARD_H = 640;
const PLAYER_X0 = 0, PLAYER_X1 = BOARD_W;            // [0, 220]
const ENEMY_X0 = CANVAS_W - BOARD_W, ENEMY_X1 = CANVAS_W; // [260, 480]
const TOWER_H = 56;
const BOARD_TOP = TOWER_H + 8, BOARD_BOTTOM = BOARD_TOP + BOARD_H - 8;
const BALL_R = 8, PEG_R = 10;
const G = 540, JIT = 50;
const BALL_LOST_Y = BOARD_BOTTOM + 30;
const PLAYER_HP_MAX = 50;

// === PALETTE ===
// Single source of truth for canvas-side colors. Keep in sync with style.css :root.
// Mapping table: peg-drop/HANDOFF.md
const PALETTE = {
  // Sky-blue background (puyo-fever style)
  skyTop:    '#7ec8ff',
  skyMid:    '#bbe6ff',
  skyBot:    '#ffd6ee',
  cloud:     'rgba(255,255,255,0.55)',
  star:      'rgba(255,255,255,0.55)',
  // Side accents (player=blue / enemy=pink) — for borders/highlights
  player:       '#4cb1ff',
  playerSoft:   'rgba(76,177,255,.85)',
  playerTint:   'rgba(124,200,255,.18)',
  enemy:        '#ff7fb1',
  enemySoft:    'rgba(255,127,177,.85)',
  enemyTint:    'rgba(255,127,177,.18)',
  // Fever accents
  yellow:    '#ffd24a',
  yellowSoft:'rgba(255,210,74,.16)',
  // Match label colors
  matchSplit:  '#74d756',
  matchBreak:  '#ffd24a',
  matchHeal:   '#65e58d',
  // Damage/heal popup
  damageText:  '#ff5266',
  healText:    '#65e58d',
  // Misc
  outlineDark: 'rgba(20,8,32,.85)',
  outlineSoft: 'rgba(20,8,32,.55)',
};

// Orb body colors are aligned 1:1 with the peg color they "match" against —
// blue orb destroys blue peg, red orb destroys red peg, green orb splits on green peg.
// Color identity = causal identity. No legend needed.
const ORBS = {
  round:  { name: 'まる',   color: '#4cb1ff', stroke: '#1f5d99', damp: 0.72, jitMul: 1.0, label: '青ペグ破壊' },
  spike:  { name: 'とげ',   color: '#ff6b7a', stroke: '#a8333f', damp: 0.85, jitMul: 0.7, label: '赤ペグ破壊' },
  drop:   { name: 'しずく', color: '#74d756', stroke: '#2e8a36', damp: 0.55, jitMul: 1.5, label: '緑ペグで分裂' },
  star:   { name: 'スター', color: '#ffd84a', stroke: '#9a6e0a', damp: 0.78, jitMul: 0.85, label: 'なんでも破壊' },
};

// Compatibility table: orbType × pegColor → effect
// Bomb peg explodes on any orb impact (chain-destroys nearby pegs).
const MATCH = {
  round:  { white: 'normal', red: 'normal',  blue: 'destroy', green: 'normal',  heal: 'heal', bomb: 'bomb' },
  spike:  { white: 'normal', red: 'destroy', blue: 'normal',  green: 'normal',  heal: 'heal', bomb: 'bomb' },
  drop:   { white: 'normal', red: 'normal',  blue: 'normal',  green: 'split',   heal: 'heal', bomb: 'bomb' },
  star:   { white: 'normal', red: 'destroy', blue: 'destroy', green: 'destroy', heal: 'heal', bomb: 'bomb' },
};
const DAMAGE = { normal: 1, destroy: 2, split: 1, heal: 0, bomb: 2 }; // heal/bomb handled with custom branches
const HEAL_AMOUNT = 2;
const BOMB_RADIUS = 62;       // chain-destroy radius for bomb peg
const BOMB_DAMAGE_CAP = 9;    // damage ceiling for bomb chain

// Peg colors locked to orb colors — same blue, same red, same green.
// "white" = neutral peg (no orb matches it) → desaturated gray so the player
// instantly reads "color = meaningful, gray = bystander".
// Logic keys (white/red/blue/green/heal) are 田尻保護, only color values change.
const PEG_FILL = {
  white: '#c8c0d4',  // neutral gray-lavender — clearly "no color"
  red:   '#ff6b7a',  // matches spike orb
  blue:  '#4cb1ff',  // matches round orb
  green: '#74d756',  // matches drop orb
  heal:  '#ff97c2',  // pink heart-pink
  bomb:  '#ffae3a',  // explosive — orange-gold body, X icon overlay
};
// Per-color bounce factor — multiplied with the ORB's damp on normal bounce
// so pegs visually feel different. White (neutral) = bounciest pinball pegs;
// colored pegs = milder bounce so ball gets to its match faster; heal = sticky.
const PEG_BOUNCE = {
  white: 1.10,
  red:   0.80,
  blue:  0.80,
  green: 0.80,
  heal:  0.55,
  bomb:  0.95,
};

// Stage 1 = teaching stage. ONLY blue + gray (white) pegs. No HEAL.
// One orb type effectively in play (round=blue) so the cause/effect rule is
// learned in 30s without reading anything: 「青玉で青ペグを壊すとダメージ」.
// Stage 2 introduces RED → spike orb pairing.
// Stage 3 is the full system (blue/red/green + HEAL).
const STAGES = [
  {
    enemyHP: 16,
    enemy: 'enemy-a-idle',
    enemyDamage: 'enemy-a-damage',
    enemyDefeat: 'enemy-a-defeat',
    enemySize: 'normal',
    aiInterval: [2.8, 3.4],
    pegPalette: ['white','white','white','white','blue','blue','blue','blue','blue','blue','blue','blue','blue','blue'],
  },
  {
    enemyHP: 26,
    enemy: 'enemy-b-idle',
    enemyDamage: 'enemy-b-damage',
    enemyDefeat: 'enemy-b-defeat',
    enemySize: 'normal',
    aiInterval: [2.1, 2.7],
    pegPalette: ['white','white','white','red','red','red','red','blue','blue','blue','blue','blue','heal','heal'],
  },
  {
    enemyHP: 44,
    enemy: 'boss-idle',
    enemyDamage: 'boss-damage',
    enemyDefeat: 'boss-defeat',
    enemySize: 'boss',
    aiInterval: [1.55, 2.05],
    pegPalette: ['white','red','red','red','blue','blue','blue','green','green','green','green','green','heal','heal'],
  },
];

const LAP_DIFFICULTY = {
  maxLap: 10,
  hpPerLap: 0.20,
  bossHpPerLap: 0.03,
  aiFasterPerLap: 0.06,
  bossAiFasterPerLap: 0.01,
  minAiScale: 0.52,
  minAiInterval: 0.7,
  dampPerLap: 0.01,
  jitPerLap: 0.03,
  maxJitBonus: 0.30,
};

function getStoredClearCount() {
  return Math.max(0, Number(localStorage.getItem('peg-drop:clears')) || 0);
}

function rollInterval([min, max]) {
  return min + Math.random() * (max - min);
}

function getLapCountFromPalette(palette) {
  return palette.reduce((counts, color) => {
    counts[color] = (counts[color] || 0) + 1;
    return counts;
  }, { white: 0, red: 0, blue: 0, green: 0, heal: 0 });
}

function buildLapOrbPhysics(lap) {
  const jitBonus = Math.min(LAP_DIFFICULTY.maxJitBonus, lap * LAP_DIFFICULTY.jitPerLap);
  const dampPenalty = lap * LAP_DIFFICULTY.dampPerLap;
  const tuned = {};
  for (const [orb, cfg] of Object.entries(ORBS)) {
    tuned[orb] = {
      damp: Math.max(0.48, Number((cfg.damp - dampPenalty).toFixed(2))),
      jitMul: Number((cfg.jitMul + jitBonus).toFixed(2)),
    };
  }
  return tuned;
}

function applyLapDifficulty(baseCfg, playLap = 0) {
  const lap = Math.min(Math.max(0, playLap), LAP_DIFFICULTY.maxLap);
  const hpScale = 1
    + lap * LAP_DIFFICULTY.hpPerLap
    + (baseCfg.enemySize === 'boss' ? lap * LAP_DIFFICULTY.bossHpPerLap : 0);
  const aiScale = Math.max(
    LAP_DIFFICULTY.minAiScale,
    1
      - lap * LAP_DIFFICULTY.aiFasterPerLap
      - (baseCfg.enemySize === 'boss' ? lap * LAP_DIFFICULTY.bossAiFasterPerLap : 0)
  );
  const pegPalette = [...baseCfg.pegPalette];
  // Bomb peg unlocks at lap 1 — replaces 1-2 white (filler) pegs so density
  // stays similar but the explosive variant introduces real strategy.
  if (lap >= BOMB_PEG_LAP) {
    const bombs = Math.min(2, lap);
    let inserted = 0;
    for (let i = 0; i < pegPalette.length && inserted < bombs; i++) {
      if (pegPalette[i] === 'white') {
        pegPalette[i] = 'bomb';
        inserted++;
      }
    }
  }
  if (baseCfg.enemySize === 'boss' && lap >= 5) {
    const whiteIdx = pegPalette.indexOf('white');
    if (whiteIdx >= 0) pegPalette[whiteIdx] = 'green';
  }
  if (baseCfg.enemySize === 'boss' && lap >= 8) {
    const blueIdx = pegPalette.indexOf('blue');
    if (blueIdx >= 0) pegPalette[blueIdx] = 'red';
  }
  return {
    ...baseCfg,
    lap,
    enemyHP: Math.round(baseCfg.enemyHP * hpScale),
    enemyHPBase: baseCfg.enemyHP,
    aiInterval: baseCfg.aiInterval.map(v => Math.max(
      LAP_DIFFICULTY.minAiInterval,
      Number((v * aiScale).toFixed(2))
    )),
    pegPalette,
    pegCounts: getLapCountFromPalette(pegPalette),
    orbPhysics: buildLapOrbPhysics(lap),
  };
}

// Balance reference:
// lap0:  S1 HP16 / 2.8-3.4s / W4 B10, S2 HP26 / 2.1-2.7s / W3 R4 B5 H2, S3 HP44 / 1.55-2.05s / W1 R3 B3 G5 H2
// lap3:  S1 HP26 / 2.30-2.79s,        S2 HP42 / 1.72-2.21s,        S3 HP74 / 1.22-1.62s
// lap9:  S1 HP45 / 1.46-1.77s,        S2 HP73 / 1.09-1.40s,        S3 HP135 / 0.81-1.07s

// Per-layout normalize: map each layout's actual source y-range to the
// playable canvas y-range. Top buffer keeps pegs clear of the cannon mouth
// so balls have a clean drop zone before first contact.
const LAYOUT_Y_TOP = TOWER_H + 60;       // top peg row target — keeps gap below cannon
const LAYOUT_Y_BOT = CANVAS_H - 20;      // bottom peg row target
function scaleLayoutY(layout) {
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of layout) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const span = Math.max(1, yMax - yMin);
  const scale = (LAYOUT_Y_BOT - LAYOUT_Y_TOP) / span;
  return layout.map(([x, y]) => [x, Math.round(LAYOUT_Y_TOP + (y - yMin) * scale)]);
}

// Peg layout templates per stage. Spacing is intentionally non-uniform —
// dense clusters and unexpected gaps are encouraged. If a ball gets stuck
// in a tight cluster, updateBalls's stuck-detection clears it after 1s.
const BOARD_LAYOUTS = [
  // Stage 1 — "SPLATTER": loose top, dense center diamond, scattered tail
  scaleLayoutY([
    [60,140],[180,150],
    [35,195],[110,180],[160,210],
    [85,235],[195,240],
    [40,275],[75,290],[110,275],[145,290],[180,295],
    [25,335],[60,355],[105,335],[150,355],[195,340],
    [90,395],[130,395],
    [25,440],[55,455],[110,445],[165,455],[200,440],
    [50,510],[110,500],[170,510],
    [85,575],[140,575],
  ]),
  // Stage 2 — "CASCADE FUNNEL": wide top, tight central neck, wide bottom
  scaleLayoutY([
    [25,140],[70,150],[120,140],[170,150],[200,140],
    [50,200],[110,205],[170,200],
    [85,250],[140,250],
    [60,295],[110,310],[160,295],
    [30,350],[80,360],[140,360],[190,350],
    [55,410],[110,420],[165,410],
    [25,470],[70,470],[150,470],[195,470],
    [40,540],[110,545],[180,540],
    [85,610],[140,610],
  ]),
  // Stage 3 — "FORTRESS BOSS": dense outer ring, central kill zone with traps
  scaleLayoutY([
    [25,135],[70,140],[110,135],[150,140],[195,135],
    [22,180],[200,180],
    [50,225],[100,215],[140,215],[190,225],
    [25,275],[200,275],
    [70,300],[150,300],
    [25,340],[200,340],
    [55,375],[110,365],[165,375],
    [25,420],[200,420],
    [85,465],[135,465],
    [40,520],[110,510],[180,520],
    [60,580],[110,595],[160,580],
  ]).slice(0, 28),
];
// Preserve global reference for any legacy usage; defaults to stage 1.
const BOARD_LAYOUT = BOARD_LAYOUTS[0];

// Reduced-motion: respected by both CSS @media and Canvas drawing branches
const PREFERS_REDUCED_MOTION = (typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Pre-baked star field (positions fixed per session — cheap & non-distracting)
// Sparse on purpose — pegs/balls are the subject, not the backdrop.
const STAR_FIELD = (() => {
  const stars = [];
  const seed = [
    [38, 86, 1.5], [438, 70, 1.4],
    [70, 200, 1.3], [410, 240, 1.5],
    [25, 360, 1.3], [455, 410, 1.4],
  ];
  for (const [x, y, s] of seed) stars.push({ x, y, s });
  return stars;
})();
// Cloud bands removed — the dark arena interior (drawArenaInterior) is the
// playfield, not a sky. Less noise behind pegs.
const CLOUD_BANDS = [];

// === Asset images (preloaded, used via drawImage) ===
function loadImg(src) { const i = new Image(); i.src = src; return i; }
const ASSET = {
  framePlayer: loadImg('assets/01_board_frame_blue_clean.png'),
  frameEnemy:  loadImg('assets/02_board_frame_pink_clean.png'),
  // Player cannon variants — 10 turtle-themed cannons, one per lap. Cycles
  // every full playthrough so repeat plays feel fresh.
  cannonPlayerByLap: [
    loadImg('assets/cannon-player-0.png'),
    loadImg('assets/cannon-player-1.png'),
    loadImg('assets/cannon-player-2.png'),
    loadImg('assets/cannon-player-3.png'),
    loadImg('assets/cannon-player-4.png'),
    loadImg('assets/cannon-player-5.png'),
    loadImg('assets/cannon-player-6.png'),
    loadImg('assets/cannon-player-7.png'),
    loadImg('assets/cannon-player-8.png'),
    loadImg('assets/cannon-player-9.png'),
  ],
  // Color-coded cannon (legacy fallback when a lap variant fails to load)
  cannonBody: {
    round: loadImg('assets/cannon-blue.png'),
    spike: loadImg('assets/cannon-red.png'),
    drop:  loadImg('assets/cannon-green.png'),
  },
  // Enemy cannons — fixed per stage (not per orb). Stage 1: purple alien,
  // stage 2: blue ghost, stage 3: black-hat boss.
  cannonEnemyByStage: [
    loadImg('assets/cannon-enemy-s1.png'),
    loadImg('assets/cannon-enemy-s2.png'),
    loadImg('assets/cannon-enemy-s3.png'),
  ],
  cannonByOrb: {},
  pegByColor: {
    blue:  loadImg('assets/peg-big-blue.png'),
    red:   loadImg('assets/peg-big-red.png'),
    green: loadImg('assets/peg-big-green.png'),
    white: loadImg('assets/peg-big-gray.png'),
    heal:  loadImg('assets/peg-big-purple.png'),
  },
  hitBurst: loadImg('assets/13_hit_effect_star_burst.png'),
};

let state, lastT;

function load(key, def) {
  const v = localStorage.getItem(key);
  return v == null ? def : Number(v);
}
function save(key, v) {
  localStorage.setItem(key, String(v));
}

// Deterministic LCG so a given (lap, stageIdx) always produces the same
// augmented layout — players can learn it round-to-round, but it differs
// between loops.
function lapRng(lap, stageIdx) {
  let seed = ((lap + 1) * 9301 + (stageIdx + 1) * 49297 + 1729) | 0;
  return function () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function augmentLayoutForLap(base, lap, stageIdx) {
  if (lap <= 0) return base.map(([x, y]) => [x, y]);
  const rng = lapRng(lap, stageIdx);
  // Slight horizontal jitter so the field doesn't feel identical to lap 0.
  const jitterMag = Math.min(8, 2 + lap);
  const jittered = base.map(([x, y]) => {
    const dx = Math.round((rng() - 0.5) * jitterMag);
    return [Math.max(20, Math.min(BOARD_W - 20, x + dx)), y];
  });
  // Add procedural extras at lap-scaled count, with min-distance to keep
  // the board readable. Cap at +8 pegs so density stays sane.
  const extras = Math.min(8, lap * 2);
  const out = jittered.slice();
  for (let i = 0; i < extras; i++) {
    for (let t = 0; t < 18; t++) {
      const px = 22 + Math.round(rng() * (BOARD_W - 44));
      const py = LAYOUT_Y_TOP + Math.round(rng() * (LAYOUT_Y_BOT - LAYOUT_Y_TOP));
      let ok = true;
      for (const [ex, ey] of out) {
        if (Math.hypot(px - ex, py - ey) < 28) { ok = false; break; }
      }
      if (ok) {
        out.push([px, py]);
        break;
      }
    }
  }
  return out;
}

function buildBoard(palette, stageIdx = 0, lap = 0) {
  const baseLayout = BOARD_LAYOUTS[stageIdx] || BOARD_LAYOUTS[0];
  const layout = augmentLayoutForLap(baseLayout, lap, stageIdx);
  return layout.map(([x, y], i) => ({
    x, y,
    color: palette[i % palette.length],
    alive: true,
    hitFlash: 0,
  }));
}

// Shuffle palette deterministically per stage build
function shufflePalette(palette) {
  const arr = [...palette];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Orb pool widens as the player progresses — tutorial→full system in 3 stages.
// Stage 0: round only (one orb, one peg color, learn the loop)
// Stage 1: round + spike (red enters)
// Stage 2: full set (drop / split + heal in play)
const ORB_POOL_PER_STAGE = [
  ['round'],
  ['round', 'spike'],
  ['round', 'spike', 'drop'],
];

// Star orb (wild) unlocks once the player has cleared the adventure twice.
const STAR_ORB_LAP = 2;
// Bomb peg unlocks after the first clear (lap 1).
const BOMB_PEG_LAP = 1;

function getOrbPoolFor(stageIdx, lap = 0) {
  const base = ORB_POOL_PER_STAGE[stageIdx] || ORB_POOL_PER_STAGE[0];
  return lap >= STAR_ORB_LAP ? [...base, 'star'] : base;
}

function generateQueueOrb(stageIdx = 0, lap = 0) {
  const pool = getOrbPoolFor(stageIdx, lap);
  return pool[Math.floor(Math.random() * pool.length)];
}

function fillQueue(queue, minSize = 8, stageIdx = 0, lap = 0) {
  while (queue.length < minSize) {
    queue.push(generateQueueOrb(stageIdx, lap));
  }
}

function setEnemyState(s) {
  enemySlot.dataset.state = s;
}
function setPlayerState(s) {
  mascotSlot.dataset.state = s;
}
function flashClass(el, cls, dur) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), dur);
}
function bumpVsBurst() {
  const vsEl = document.querySelector('.vs-divider');
  if (!vsEl) return;
  vsEl.classList.remove('flash');
  void vsEl.offsetWidth;
  vsEl.classList.add('flash');
}
function triggerPlateReaction(side, heal = false) {
  const plate = side === 'enemy'
    ? enemyHpFill?.parentElement
    : playerHpFill?.parentElement;
  if (!plate) return;
  flashClass(plate, heal ? 'heal-pop' : 'plate-hit', heal ? 520 : 620);
}

// Player sprite map: dedicated images for each state.
const MASCOT_SPRITE = {
  idle:    'assets/turtle-idle.png',
  attack:  'assets/turtle-attack.png',
  damage:  'assets/turtle-damage.png',
  defeat:  'assets/turtle-defeat.png',
  victory: 'assets/turtle-victory.png',
};
function setMascotSprite(state) {
  const src = MASCOT_SPRITE[state] || MASCOT_SPRITE.idle;
  if (!mascotImg.src.endsWith(src)) mascotImg.src = src;
}
function flashMascot(cls, dur, sprite) {
  if (sprite) setMascotSprite(sprite);
  flashClass(mascotSlot, cls, dur);
  if (sprite && sprite !== 'idle' && sprite !== 'defeat') {
    setTimeout(() => setMascotSprite('idle'), dur);
  }
}
function flashEnemyDamageSprite() {
  const cfg = STAGES[state.stageIdx];
  const idleSrc = `assets/${cfg.enemy}.png`;
  const dmgSrc = `assets/${cfg.enemyDamage}.png`;
  enemyImg.src = dmgSrc;
  setTimeout(() => {
    if (state && state.phase !== 'ended' && enemyImg.src.endsWith(dmgSrc.split('/').pop())) {
      enemyImg.src = idleSrc;
    }
  }, 240);
}
function getIdleStateForEnemy(cfg) {
  if (cfg.enemySize === 'boss') return 'boss-idle';
  if (cfg.enemy.includes('enemy-b')) return 'ghost-idle';
  return 'idle';
}

function resetEnemyActTimer() {
  state.enemyActClock = 0;
  state.enemyActAt = rollInterval(state.stageCfg.aiInterval);
}

function startStage(idx) {
  const playLap = getStoredClearCount();
  const cfg = applyLapDifficulty(STAGES[idx], playLap);
  const playerQueue = [];
  const enemyQueue = [];
  fillQueue(playerQueue, 8, idx, playLap);
  fillQueue(enemyQueue, 8, idx, playLap);
  state = {
    phase: 'countdown', // countdown / aim / dropping / resolving / ended
    stageIdx: idx,
    stageCfg: cfg,
    countdownT: 0,
    round: 1,
    playerHP: PLAYER_HP_MAX,
    enemyHP: cfg.enemyHP,
    enemyHPMax: cfg.enemyHP,
    queue: playerQueue,
    enemyQueue,
    aimX: BOARD_W / 2,
    enemyAimX: BOARD_W / 2,
    enemyCannonX: BOARD_W / 2,
    playerPegs: buildBoard(shufflePalette(cfg.pegPalette), idx, playLap),
    enemyPegs: buildBoard(shufflePalette(cfg.pegPalette), idx, playLap),
    playerBalls: [],
    enemyBalls: [],
    pegBreakAnims: [],
    damagePopups: [],
    attackBeams: [],
    firstTapHint: idx === 0,
    // Clear count is now monotonic; visuals still cycle by modulo elsewhere.
    playLap,
    screenShake: 0,
    enemyHitFlash: 0,
    playerHitFlash: 0,
    lastTakeDmg: 0,
    pendingResolveDelay: 0,
    enemyActClock: 0,
    enemyActAt: rollInterval(cfg.aiInterval),
    cannonBursts: [],
    boardSparkles: [],
    chainFrame: null,
    // Best-of-3 tracker per stage. Resets when entering a new stage.
    playerWins: 0,
    enemyWins: 0,
  };
  const baseStage = STAGES[idx];
  enemyImg.src = `assets/${baseStage.enemy}.png`;
  enemySlot.classList.toggle('boss', cfg.enemySize === 'boss');
  setEnemyState(getIdleStateForEnemy(cfg));
  setPlayerState('idle');
  setMascotSprite('idle');
  enemySlot.classList.add('appear');
  setTimeout(() => enemySlot.classList.remove('appear'), 380);
  updateHUD();
  updateQueueUI();
  updateRoundStars();
  const sub = cfg.enemySize === 'boss'
    ? 'BOSS — 先に 2 勝でクリア！'
    : '先に 2 勝でステージクリア！';
  showOverlay(`STAGE ${idx + 1}!`, sub, PALETTE.yellow);
}

const ORB_LABELS = {
  round: '青こわす',
  spike: '赤こわす',
  drop: '緑ふやす',
};

const ORB_TARGET_COLOR = {
  round: PEG_FILL.blue,
  spike: PEG_FILL.red,
  drop:  PEG_FILL.green,
};

function updateQueueUI() {
  /* canvas-rendered now (drawCannon in render) */
}

function updateHUD() {
  const p = Math.max(0, state.playerHP) / PLAYER_HP_MAX;
  const e = Math.max(0, state.enemyHP) / state.enemyHPMax;
  playerHpFill.style.width = (p * 100) + '%';
  enemyHpFill.style.width = (e * 100) + '%';
  if (playerHpText) playerHpText.textContent = Math.max(0, state.playerHP);
  if (enemyHpText) enemyHpText.textContent = Math.max(0, state.enemyHP);
  stageEl.textContent = `${state.stageIdx + 1}/${STAGES.length}`;
}

function dropBall(side, x, orbType) {
  const ball = {
    x, y: BOARD_TOP - 10, vx: 0, vy: 0,
    orb: orbType,
    side, // 'player' or 'enemy'
    age: 0,
  };
  if (side === 'player') state.playerBalls.push(ball);
  else state.enemyBalls.push(ball);
  state.cannonBursts.push({ side, x: x + getBoardX(side), t: 0, dur: 0.16 });
  bumpVsBurst();
}

function playerDrop() {
  if (state.phase !== 'aim') return;
  if (state.queue.length === 0) return;
  const orb = state.queue.shift();
  fillQueue(state.queue, 8, state.stageIdx, state.playLap || 0);
  dropBall('player', state.aimX, orb);
  // Enemy drops simultaneously (lockstep)
  enemyDropResponse();
  resetEnemyActTimer();
  state.phase = 'dropping';
  state.firstTapHint = false;
  updateQueueUI();
}

function enemyDropResponse() {
  // Use enemy queue (visual consistency with player)
  const orbType = state.enemyQueue.shift();
  fillQueue(state.enemyQueue, 8, state.stageIdx, state.playLap || 0);
  const x = pickAIPosition(orbType);
  // Tell drawCannon where the enemy cannon should glide to so the ball
  // visibly drops from the cannon mouth, not the board center.
  state.enemyAimX = x;
  dropBall('enemy', x, orbType);
}

function pickAIPosition(orbType) {
  // Find x position that maximizes expected hits
  // Sample 5 positions, pick best
  const candidates = [];
  for (let i = 0; i < 5; i++) {
    const x = 30 + (i / 4) * (BOARD_W - 60);
    let score = 0;
    for (const p of state.enemyPegs) {
      if (!p.alive) continue;
      const dx = Math.abs(p.x - x);
      // Closer pegs in vertical line are more likely hit
      if (dx < 60) {
        const eff = MATCH[orbType][p.color];
        score += DAMAGE[eff] * Math.max(0, 1 - dx / 60);
      }
    }
    candidates.push({ x, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  // Pick from top 2 with some randomness
  const choice = Math.random() < 0.7 ? candidates[0] : candidates[1];
  return choice.x + (Math.random() - 0.5) * 30;
}

function pickAIOrb() {
  // Count peg colors on enemy board
  const counts = { white: 0, red: 0, blue: 0, green: 0 };
  for (const p of state.enemyPegs) if (p.alive) counts[p.color]++;
  let bestOrb = 'round', bestScore = -1;
  for (const orb of ['round', 'spike', 'drop']) {
    let score = 0;
    for (const c of ['white', 'red', 'blue', 'green']) {
      const eff = MATCH[orb][c];
      score += counts[c] * DAMAGE[eff];
    }
    if (score > bestScore) { bestScore = score; bestOrb = orb; }
  }
  // 30% chance to be random for variety
  if (Math.random() < 0.3) bestOrb = ['round','spike','drop'][Math.floor(Math.random()*3)];
  return bestOrb;
}

function getBoardX(side) { return side === 'player' ? PLAYER_X0 : ENEMY_X0; }

function updateBalls(balls, pegs, side, dt) {
  const remove = [];
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    b.age += dt;
    const orbCfg = state.stageCfg.orbPhysics[b.orb] || ORBS[b.orb];
    const damp = orbCfg.damp;
    const jit = JIT * orbCfg.jitMul;
    // Stuck-ball detection: when speed stays low for STUCK_LIMIT seconds,
    // despawn the ball so dense peg clusters can't permanently trap it.
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 38) b.stuckT = (b.stuckT || 0) + dt;
    else b.stuckT = 0;
    if (b.stuckT > 1.0) {
      remove.push(i);
      // Visual cue: small fizzle popup at the spot
      spawnDamagePopup(b.x + getBoardX(side), b.y, '…', '#ffffff', false);
      continue;
    }
    b.vy += G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Collision with pegs
    for (const p of pegs) {
      if (!p.alive) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < BALL_R + PEG_R && d > 0) {
        // Determine effect
        const effect = MATCH[b.orb][p.color];
        const isMatch = effect !== 'normal';
        if (effect === 'bomb') {
          // Bomb peg explodes: chain-destroy nearby pegs and damage opponent.
          const chained = [];
          for (const q of pegs) {
            if (!q.alive || q === p) continue;
            const ddx = q.x - p.x, ddy = q.y - p.y;
            if (Math.hypot(ddx, ddy) <= BOMB_RADIUS) chained.push(q);
          }
          const totalDmg = Math.min(BOMB_DAMAGE_CAP, DAMAGE.bomb + chained.length);
          const oppSide = side === 'player' ? 'enemy' : 'player';
          const sourceX = p.x + getBoardX(side);
          if (side === 'player') {
            state.enemyHP = Math.max(0, state.enemyHP - totalDmg);
            state.enemyHitFlash = 0.45;
            spawnDamagePopup(sourceX, p.y, totalDmg, PALETTE.damageText, true);
            spawnMatchText(sourceX, p.y - 22, 'BOOM!', '#ff8d3a');
            flashMascot('attack', 380, 'attack');
            flashClass(enemySlot, 'damage', 380);
            flashEnemyDamageSprite();
            triggerPlateReaction('enemy');
            state.slowMo = 0.08;
          } else {
            state.playerHP = Math.max(0, state.playerHP - totalDmg);
            state.playerHitFlash = 0.45;
            state.screenShake = 0.7;
            state.lastTakeDmg = totalDmg;
            spawnDamagePopup(sourceX, p.y, totalDmg, PALETTE.damageText, true);
            spawnMatchText(sourceX, p.y - 22, 'BOOM!', '#ff8d3a');
            flashMascot('damage', 480, 'damage');
            triggerPlateReaction('player');
          }
          state.attackBeams.push({
            x0: sourceX, y0: p.y,
            x1: side === 'player' ? CANVAS_W - 14 : 14, y1: 0,
            color: side === 'player' ? PALETTE.player : PALETTE.enemy,
            t: 0, dur: 0.30,
          });
          setTimeout(() => spawnHpDamagePopup(oppSide, totalDmg, false), 240);
          // Destroy chained pegs (no extra individual damage — already pooled)
          for (const q of chained) {
            q.alive = false;
            q.hitFlash = 0.20;
            state.pegBreakAnims.push({ x: q.x + getBoardX(side), y: q.y, t: 0, dur: 0.50, color: q.color });
          }
          // Bomb peg itself
          p.alive = false;
          p.hitFlash = 0.40;
          state.pegBreakAnims.push({ x: p.x + getBoardX(side), y: p.y, t: 0, dur: 0.55, color: 'bomb' });
          if (!state.chainFrame) state.chainFrame = {};
          if (!state.chainFrame[side]) state.chainFrame[side] = { count: 0, x: 0, y: 0 };
          state.chainFrame[side].count += 1 + chained.length;
          state.chainFrame[side].x += sourceX;
          state.chainFrame[side].y += p.y;
          updateHUD();
          // Ball passes through with strong horizontal kick
          b.vy *= 0.7;
          b.vx += (Math.random() - 0.5) * 110;
          break; // 1 collision per frame
        }
        if (effect === 'heal') {
          // Heal own side instead of damaging opponent
          if (side === 'player') {
            state.playerHP = Math.min(PLAYER_HP_MAX, state.playerHP + HEAL_AMOUNT);
            spawnDamagePopup(p.x + getBoardX('player'), p.y, '+' + HEAL_AMOUNT, PALETTE.healText, true);
            spawnMatchText(p.x + getBoardX('player'), p.y - 20, 'HEAL!', PALETTE.matchHeal);
            setTimeout(() => spawnHpDamagePopup('player', HEAL_AMOUNT, true), 220);
            triggerPlateReaction('player', true);
          } else {
            state.enemyHP = Math.min(state.enemyHPMax, state.enemyHP + HEAL_AMOUNT);
            spawnDamagePopup(p.x + getBoardX('enemy'), p.y, '+' + HEAL_AMOUNT, PALETTE.healText, true);
            spawnMatchText(p.x + getBoardX('enemy'), p.y - 20, 'HEAL!', PALETTE.matchHeal);
            setTimeout(() => spawnHpDamagePopup('enemy', HEAL_AMOUNT, true), 220);
            triggerPlateReaction('enemy', true);
          }
        } else {
          const dmg = DAMAGE[effect];
          // Apply damage to OPPONENT HP
          if (side === 'player') {
            state.enemyHP = Math.max(0, state.enemyHP - dmg);
            state.enemyHitFlash = isMatch ? 0.35 : 0.18;
            spawnDamagePopup(p.x + getBoardX('enemy'), p.y, dmg, PALETTE.damageText, isMatch);
            // Player attacked → enemy gets damage anim + sprite swap
            flashMascot('attack', 320, 'attack');
            flashClass(enemySlot, 'damage', 360);
            flashEnemyDamageSprite();
            if (isMatch) {
              const label = effect === 'destroy' ? 'BREAK!' : 'SPLIT!';
              spawnMatchText(p.x + getBoardX('enemy'), p.y - 20, label, effect === 'split' ? PALETTE.matchSplit : PALETTE.matchBreak);
              state.slowMo = 0.06;
            }
            triggerPlateReaction('enemy');
          } else {
            state.playerHP = Math.max(0, state.playerHP - dmg);
            state.playerHitFlash = isMatch ? 0.35 : 0.18;
            state.screenShake = isMatch ? 0.5 : 0.18;
            state.lastTakeDmg = dmg;
            spawnDamagePopup(p.x + getBoardX('player'), p.y, dmg, PALETTE.damageText, isMatch);
            // Enemy attacked → player gets damage anim + sad sprite swap
            flashMascot('damage', 460, 'damage');
            if (isMatch) {
              const label = effect === 'destroy' ? 'BREAK!' : 'SPLIT!';
              spawnMatchText(p.x + getBoardX('player'), p.y - 20, label, effect === 'split' ? PALETTE.matchSplit : PALETTE.matchBreak);
            }
            triggerPlateReaction('player');
          }
        }
        updateHUD();
        // Effect on peg/ball
        p.alive = false;
        p.hitFlash = 0.18;
        state.pegBreakAnims.push({ x: p.x + getBoardX(side), y: p.y, t: 0, dur: 0.42, color: p.color });
        if (!state.chainFrame) state.chainFrame = {};
        if (!state.chainFrame[side]) state.chainFrame[side] = { count: 0, x: 0, y: 0 };
        state.chainFrame[side].count++;
        state.chainFrame[side].x += p.x + getBoardX(side);
        state.chainFrame[side].y += p.y;
        // Attack beam — visualize the cause→effect across the center wall to the
        // opponent's HP bar (or self HP bar for heal).
        if (effect !== 'heal') {
          const sourceX = p.x + getBoardX(side);
          const targetX = side === 'player' ? CANVAS_W - 14 : 14;
          state.attackBeams.push({
            x0: sourceX, y0: p.y,
            x1: targetX, y1: 0,
            color: side === 'player' ? PALETTE.player : PALETTE.enemy,
            t: 0, dur: 0.30,
          });
          // DOM popup over opponent HP bar — synced ~beam end
          const targetSide = side === 'player' ? 'enemy' : 'player';
          const dmgValue = DAMAGE[effect];
          setTimeout(() => spawnHpDamagePopup(targetSide, dmgValue, false), 240);
        }
        if (effect === 'destroy') {
          // Ball passes through with slight slowdown + small horizontal kick
          // so the impact reads visually (otherwise ball just ghosts through).
          b.vy *= 0.85;
          b.vx += (Math.random() - 0.5) * 80;
        } else if (effect === 'split') {
          // Spawn second ball at same position with offset velocity
          const newBall = { ...b, vx: -200 + Math.random() * 50, vy: -100 + Math.random() * 50 };
          // Limit total balls
          if (balls.length < 6) {
            balls.push(newBall);
          }
          // Original bounces
          const nx = dx / d, ny = dy / d;
          b.x = p.x + nx * (BALL_R + PEG_R);
          b.y = p.y + ny * (BALL_R + PEG_R);
          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * damp + (Math.random() - 0.5) * jit + 200;
          b.vy = (b.vy - 2 * dot * ny) * damp;
        } else {
          // Normal bounce — peg color modulates bounce strength.
          const colorBounce = PEG_BOUNCE[p.color] || 1.0;
          const nx = dx / d, ny = dy / d;
          b.x = p.x + nx * (BALL_R + PEG_R);
          b.y = p.y + ny * (BALL_R + PEG_R);
          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * damp * colorBounce + (Math.random() - 0.5) * jit;
          b.vy = (b.vy - 2 * dot * ny) * damp * colorBounce;
        }
        break; // 1 collision per frame
      }
    }
    // Walls (board-local 0 to BOARD_W)
    if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx) * damp; }
    if (b.x > BOARD_W - BALL_R) { b.x = BOARD_W - BALL_R; b.vx = -Math.abs(b.vx) * damp; }
    if (b.y > BALL_LOST_Y) {
      remove.push(i);
    }
  }
  // Remove fallen balls (back-to-front)
  for (let i = remove.length - 1; i >= 0; i--) {
    balls.splice(remove[i], 1);
  }
}

function spawnDamagePopup(x, y, value, color = PALETTE.yellow, big = false) {
  state.damagePopups.push({ x, y, value, t: 0, dur: 0.6, color, big });
}

// DOM-layer popup floating above the actual HP bar — clinches the cause→effect
// (peg break → light beam → HP bar damage label).
function spawnHpDamagePopup(side, value, isHeal = false) {
  const bar = side === 'enemy' ? enemyHpFill.parentElement : playerHpFill.parentElement;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = isHeal ? 'hp-popup heal' : 'hp-popup';
  el.textContent = (isHeal ? '+' : '-') + value;
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function spawnMatchText(x, y, text, color) {
  if (!state.matchTexts) state.matchTexts = [];
  const combo = /CHAIN/.test(text);
  state.matchTexts.push({ x, y, text, color, t: 0, dur: combo ? 1.0 : 0.82, combo });
}

function checkVictory() {
  if (state.phase === 'ended' || state.phase === 'countdown') return;
  if (state.enemyHP <= 0 && state.playerHP <= 0) {
    state.phase = 'ended';
    // Tie — favor player (zen)
    onStageEnd(true);
    return;
  }
  if (state.enemyHP <= 0) {
    state.phase = 'ended';
    onStageEnd(true);
  } else if (state.playerHP <= 0) {
    state.phase = 'ended';
    onStageEnd(false);
  }
}

function onStageEnd(won) {
  // Best-of-3: each stage is first-to-2-rounds. Track per-side wins, only
  // advance when one side reaches 2.
  if (won) state.playerWins = (state.playerWins || 0) + 1;
  else state.enemyWins = (state.enemyWins || 0) + 1;
  updateRoundStars();
  const cfg = STAGES[state.stageIdx];
  const STAGE_TARGET = 2; // 2 wins clears stage
  if (won && state.playerWins < STAGE_TARGET) {
    // Round won but stage not cleared — flash, brief banner, restart round
    showOverlay('ROUND WIN!', `あと ${STAGE_TARGET - state.playerWins} 勝でステージクリアがめ！`, PALETTE.player);
    setTimeout(() => { hideOverlay(); restartRound(); }, 1300);
    return;
  }
  if (!won && state.enemyWins < STAGE_TARGET) {
    showOverlay('ROUND LOST', `あと ${STAGE_TARGET - state.enemyWins} 度負けたら敗北がめ…！`, PALETTE.damageText);
    setMascotSprite('damage');
    flashClass(mascotSlot, 'damage', 360);
    setTimeout(() => { hideOverlay(); setMascotSprite('idle'); restartRound(); }, 1300);
    return;
  }
  // Stage decided
  if (won) {
    enemyImg.src = `assets/${cfg.enemyDefeat}.png`;
    setEnemyState(''); // stop idle anim
    enemySlot.classList.add('crumble');
    flashMascot('victory', 1200);
    if (state.stageIdx + 1 >= STAGES.length) {
      // Final victory
      showOverlay('VICTORY!', `冒険クリア！`, PALETTE.yellow);
      setTimeout(() => onFinalVictory(), 1500);
    } else {
      hideOverlay();
      const clearDlg = document.querySelector('#stage-clear-dialog');
      const advance = () => {
        enemySlot.classList.remove('crumble');
        startStage(state.stageIdx + 1);
      };
      const onClose = () => { clearDlg.removeEventListener('close', onClose); advance(); };
      clearDlg.addEventListener('close', onClose);
      clearDlg.showModal();
    }
  } else {
    setPlayerState(''); // stop idle anim
    setMascotSprite('defeat');
    flashClass(mascotSlot, 'damage', 360);
    showOverlay('DEFEAT', `${state.stageIdx + 1} ステージで力尽きた`, PALETTE.damageText);
    setTimeout(() => {
      onDefeat();
    }, 1500);
  }
}

function restartRound() {
  // Re-prep board for next round of the same stage. Keep wins, restart pegs/HP.
  const cfg = STAGES[state.stageIdx];
  const adjusted = applyLapDifficulty(cfg, state.playLap || 0);
  state.playerHP = PLAYER_HP_MAX;
  state.enemyHP = adjusted.enemyHP;
  state.enemyHPMax = adjusted.enemyHP;
  state.playerPegs = buildBoard(shufflePalette(adjusted.pegPalette), state.stageIdx, state.playLap || 0);
  state.enemyPegs = buildBoard(shufflePalette(adjusted.pegPalette), state.stageIdx, state.playLap || 0);
  state.playerBalls = [];
  state.enemyBalls = [];
  state.queue = [];
  state.enemyQueue = [];
  fillQueue(state.queue, 8, state.stageIdx, state.playLap || 0);
  fillQueue(state.enemyQueue, 8, state.stageIdx, state.playLap || 0);
  state.phase = 'aim';
  state.aimX = BOARD_W / 2;
  state.enemyActClock = 0;
  state.enemyActAt = rollInterval(adjusted.aiInterval);
  setMascotSprite('idle');
  setPlayerState('idle');
  updateHUD();
}

function updateRoundStars() {
  // Fill star icons on the HP plates: filled stars = wins so far, empty = remaining
  const fill = (sel, wins) => {
    const stars = document.querySelectorAll(sel);
    stars.forEach((s, i) => s.classList.toggle('won', i < wins));
  };
  fill('.plate-player .plate-stars .star', state.playerWins || 0);
  fill('.plate-enemy .plate-stars .star', state.enemyWins || 0);
}

function showOverlay(title, sub, color) {
  overlayEl.querySelector('.overlay-title').textContent = title;
  overlayEl.querySelector('.overlay-sub').textContent = sub;
  overlayEl.style.color = color;
  const card = overlayEl.querySelector('.overlay-card');
  if (card) {
    card.style.animation = 'none';
    card.offsetWidth;
    card.style.animation = '';
  }
  overlayEl.classList.add('visible');
}
function hideOverlay() {
  overlayEl.classList.remove('visible');
  overlayEl.querySelector('.overlay-title').textContent = '';
  overlayEl.querySelector('.overlay-sub').textContent = '';
}

function updateAnimations(dt) {
  state.pegBreakAnims = state.pegBreakAnims.filter(a => {
    a.t += dt;
    return a.t < a.dur;
  });
  state.damagePopups = state.damagePopups.filter(p => {
    p.t += dt;
    return p.t < p.dur;
  });
  state.attackBeams = state.attackBeams.filter(b => {
    b.t += dt;
    return b.t < b.dur;
  });
  state.cannonBursts = state.cannonBursts.filter(b => {
    b.t += dt;
    return b.t < b.dur;
  });
  state.boardSparkles = state.boardSparkles.filter(s => {
    s.t += dt;
    return s.t < s.dur;
  });
  if (!PREFERS_REDUCED_MOTION && Math.random() < 0.14) {
    state.boardSparkles.push({
      x: 18 + Math.random() * (CANVAS_W - 36),
      y: BOARD_TOP + 10 + Math.random() * (BOARD_H - 24),
      t: 0,
      dur: 1.6 + Math.random() * 1.4,
      drift: (Math.random() - 0.5) * 10,
    });
  }
  if (state.matchTexts) {
    state.matchTexts = state.matchTexts.filter(m => {
      m.t += dt;
      return m.t < m.dur;
    });
  }
  for (const list of [state.playerPegs, state.enemyPegs]) {
    for (const p of list) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
    }
  }
  if (state.enemyHitFlash > 0) state.enemyHitFlash = Math.max(0, state.enemyHitFlash - dt);
  if (state.playerHitFlash > 0) state.playerHitFlash = Math.max(0, state.playerHitFlash - dt);
  if (state.screenShake > 0) state.screenShake = Math.max(0, state.screenShake - dt);
}

function updateCountdown(dt) {
  state.countdownT += dt;
  if (state.countdownT >= 1.2) {
    state.phase = 'aim';
    hideOverlay();
  }
}

function regenIfEmpty(pegs, palette) {
  const alive = pegs.filter(p => p.alive).length;
  if (alive < 8) {
    // Regenerate all pegs (fresh palette shuffle, same stage layout)
    const fresh = buildBoard(shufflePalette(palette), state.stageIdx, state.playLap || 0);
    for (let i = 0; i < pegs.length; i++) {
      pegs[i].color = fresh[i].color;
      pegs[i].alive = true;
      pegs[i].hitFlash = 0.5; // visual cue: pegs flash on respawn
    }
  }
}

function loop(t) {
  const dt = lastT ? Math.min(0.025, (t - lastT) / 1000) : 0;
  lastT = t;
  if (state.phase === 'countdown') {
    updateCountdown(dt);
  } else if (state.phase === 'aim') {
    // Only the final boss stage may fire on its own. Earlier stages stay in
    // lockstep — the enemy waits until the player taps, then responds.
    const isFinalBoss = state.stageIdx === STAGES.length - 1;
    if (isFinalBoss) {
      state.enemyActClock += dt;
      if (state.enemyActClock >= state.enemyActAt) {
        enemyDropResponse();
        resetEnemyActTimer();
        state.phase = 'dropping';
        state.firstTapHint = false;
      }
    }
  } else if (state.phase === 'dropping') {
    state.chainFrame = {};
    updateBalls(state.playerBalls, state.playerPegs, 'player', dt);
    updateBalls(state.enemyBalls, state.enemyPegs, 'enemy', dt);
    for (const side of ['player', 'enemy']) {
      const info = state.chainFrame[side];
      if (info && info.count > 1) {
        spawnMatchText(info.x / info.count, info.y / info.count - 34, `CHAIN x${info.count}!`, '#7cf6ff');
      }
    }
    checkVictory();
    // When all balls have settled, return to aim
    if (state.playerBalls.length === 0 && state.enemyBalls.length === 0 && state.phase === 'dropping') {
      state.pendingResolveDelay += dt;
      if (state.pendingResolveDelay >= 0.4) {
        state.pendingResolveDelay = 0;
        // Regenerate pegs if too few remain
        const cfg = state.stageCfg;
        regenIfEmpty(state.playerPegs, cfg.pegPalette);
        regenIfEmpty(state.enemyPegs, cfg.pegPalette);
        state.phase = 'aim';
        state.round++;
        resetEnemyActTimer();
        // Flash VS divider briefly + ready pose for both
        bumpVsBurst();
        flashClass(mascotSlot, 'ready', 480);
        flashClass(enemySlot, 'ready', 480);
      }
    } else {
      state.pendingResolveDelay = 0;
    }
  }
  updateAnimations(dt);
  render();
  requestAnimationFrame(loop);
}

// ---- RENDER ----
function render() {
  ctx.save();
  // Screen shake
  if (state.screenShake > 0) {
    const s = state.screenShake;
    ctx.translate((Math.random() - 0.5) * s * 12, (Math.random() - 0.5) * s * 12);
  }
  ctx.clearRect(-20, -20, CANVAS_W + 40, CANVAS_H + 40);
  // Board interior fill + colored rim is now handled by CSS via `.board-bg`
  // divs positioned beneath the transparent canvas. The canvas itself only
  // renders the dynamic layer: pegs, balls, cannons, popups, beams, etc.
  // Render each board
  renderBoard('player', PLAYER_X0, state.playerPegs, state.playerBalls, state.playerHitFlash);
  renderBoard('enemy', ENEMY_X0, state.enemyPegs, state.enemyBalls, state.enemyHitFlash);
  for (const s of state.boardSparkles) {
    const t = s.t / s.dur;
    const alpha = Math.sin(t * Math.PI) * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff7b8';
    drawStar(s.x + s.drift * t, s.y - 12 * t, 4 + Math.sin(t * Math.PI) * 3, 4);
    ctx.fillStyle = '#ffffff';
    drawStar(s.x + s.drift * t, s.y - 12 * t, 1.8, 4);
    ctx.restore();
  }
  // Attack beams — puyo-style energy comet from peg hit to opponent HP bar.
  for (const b of state.attackBeams) {
    const t = b.t / b.dur;
    const ease = 1 - Math.pow(1 - t, 2.4);
    const headX = b.x0 + (b.x1 - b.x0) * ease;
    const headY = b.y0 + (b.y1 - b.y0) * ease;
    const tailEase = Math.max(0, ease - 0.30);
    const tailX = b.x0 + (b.x1 - b.x0) * tailEase;
    const tailY = b.y0 + (b.y1 - b.y0) * tailEase;
    const alpha = 1 - t * 0.4;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Outer black silhouette stroke (puyo silhouette)
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = 7.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    // Colored body
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 5.0;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    // Bright white core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    // Head — big puyo-orb-shaped bright dot with halo
    ctx.fillStyle = `rgba(255,235,120,${alpha * 0.5})`;
    ctx.beginPath();
    ctx.arc(headX, headY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(headX, headY, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(headX, headY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(headX - 1.2, headY - 1.4, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Cannon = the loaded orb sitting above each board, ready to drop.
  drawCannon(PLAYER_X0, state.queue, 'player');
  drawCannon(ENEMY_X0, state.enemyQueue, 'enemy');
  for (const b of state.cannonBursts) {
    const t = b.t / b.dur;
    const alpha = 1 - t;
    const cy = BOARD_TOP - 18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = 5 - t * 2;
    ctx.beginPath();
    ctx.arc(b.x, cy, 10 + 38 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffd84f';
    ctx.lineWidth = 3 - t;
    ctx.beginPath();
    ctx.arc(b.x, cy, 8 + 34 * t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Damage popups (subtle for normal, bold for match)
  for (const p of state.damagePopups) {
    const t = p.t / p.dur;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const yOff = -32 * t;
    const fontSize = p.big ? 26 : 18;
    const popScale = p.big ? (t < 0.15 ? (t / 0.15) * 1.4 : 1.4 - (t - 0.15) * 0.55) : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(p.x, p.y + yOff);
    ctx.scale(popScale, popScale);
    ctx.font = `900 ${fontSize}px "M PLUS Rounded 1c","Hiragino Maru Gothic ProN", ui-rounded, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = (typeof p.value === 'string') ? p.value : '-' + p.value;
    // Black thick outline always
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = p.big ? 5 : 3.6;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
    // Drop shadow (offset down)
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillText(text, 0, 2);
    // Body fill
    ctx.fillStyle = p.color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // Match text (BREAK!/SPLIT!/HEAL!) — big puyo-style burst
  if (state.matchTexts) {
    for (const m of state.matchTexts) {
      const t = m.t / m.dur;
      const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      const yOff = -56 * t - 8;
      const popScale = t < 0.12 ? (t / 0.12) * 2.2 : 2.2 - (t - 0.12) * (m.combo ? 1.0 : 0.9);
      const tilt = (m.tilt ?? (Math.random() - 0.5) * 0.20);
      m.tilt = tilt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(m.x, m.y + yOff);
      ctx.scale(popScale, popScale);
      ctx.rotate(tilt + t * (m.combo ? 0.5 : 0.28));
      ctx.font = `900 italic ${m.combo ? 20 : 26}px "M PLUS Rounded 1c","Hiragino Maru Gothic ProN", Impact, ui-rounded, system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText(m.text, 1, 4);
      // Black stroke
      ctx.strokeStyle = '#1a0a2c';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeText(m.text, 0, 0);
      // White inner stroke (rim light)
      ctx.strokeStyle = m.combo ? '#9bf7ff' : '#fff2a6';
      ctx.lineWidth = m.combo ? 3 : 4;
      ctx.strokeText(m.text, 0, 0);
      // Gradient fill
      const gMatch = ctx.createLinearGradient(0, -14, 0, 14);
      gMatch.addColorStop(0, lighten(m.color, 0.55));
      gMatch.addColorStop(0.5, m.color);
      gMatch.addColorStop(1, darken(m.color, 0.18));
      ctx.fillStyle = gMatch;
      ctx.fillText(m.text, 0, 0);
      ctx.restore();
    }
  }
  // Peg break particles — puyo chain pop: expanding shockwave ring + scattered
  // mini-puyo shards with eyes + sparkle stars in 8 directions.
  for (const a of state.pegBreakAnims) {
    const progress = a.t / a.dur;
    const ease = 1 - Math.pow(1 - progress, 2);
    const baseColor = PEG_FILL[a.color];
    const alpha = 1 - progress;
    const lightCol = lighten(baseColor, 0.4);
    // 1. Expanding shockwave ring (thick black + colored)
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6 + 30 * progress, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = lightCol;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6 + 30 * progress, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // 2. Radial sparks
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + a.t * 2.2;
      const sparkLen = 10 + 28 * ease;
      const px0 = a.x + Math.cos(ang) * 6;
      const py0 = a.y + Math.sin(ang) * 6;
      const px1 = a.x + Math.cos(ang) * sparkLen;
      const py1 = a.y + Math.sin(ang) * sparkLen;
      ctx.strokeStyle = `rgba(${hexToRgb(lightCol)},${alpha})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
    }
    // 3. Six mini-shards flying out
    const shardDist = 26 * ease;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + a.t * 1.6;
      const px = a.x + Math.cos(ang) * shardDist;
      const py = a.y + Math.sin(ang) * shardDist + 6 * progress * progress; // slight gravity
      const sz = 2.8 * (1 - progress * 0.6);
      if (sz < 0.5) continue;
      ctx.fillStyle = `rgba(26,10,44,${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(px, py, sz + 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${hexToRgb(lightCol)},${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
      ctx.beginPath();
      ctx.arc(px - sz * 0.3, py - sz * 0.4, sz * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    // 4. Four sparkle stars further out
    const sparkDist = 38 * ease;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 - Math.PI / 2 + a.t * 3.2;
      const px = a.x + Math.cos(ang) * sparkDist;
      const py = a.y + Math.sin(ang) * sparkDist;
      const size = 4.6 * (1 - progress * 0.5);
      ctx.fillStyle = `rgba(255,235,120,${alpha})`;
      drawStar(px, py, size, 4);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      drawStar(px, py, size * 0.45, 4);
    }
    // 5. Asset star burst at the core
    if (ASSET.hitBurst.complete && ASSET.hitBurst.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.95;
      const size = 44 + 34 * progress;
      ctx.translate(a.x, a.y);
      ctx.rotate(progress * 0.7);
      ctx.drawImage(ASSET.hitBurst, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    // 6. Center flash (brief at start)
    if (progress < 0.35) {
      const fa = (1 - progress / 0.35) * 0.85;
      ctx.fillStyle = `rgba(255,255,255,${fa})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 11 + progress * 24, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

function hexToRGB(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRGB(hex);
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
function darken(hex, amt) {
  const [r, g, b] = hexToRGB(hex);
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

// Puyo-VS framed arena — multi-layer plastic cabinet:
//   drop-shadow → black outer hairline → bright bevel band → colored body
//   → black inner ring → dark glass arena (radial vignette + top shade).
// Plus 4 corner rivets, a top "cabinet sticker" tab and bottom score plate.
// Simple dark interior fill matching the asset frame's transparent cutout.
// The frame asset already provides border/rivets/colored band — we only paint
// the dark playfield underneath here.
function drawBoardRim(x, w, h, lightCol, darkCol) {
  // Thin rounded rim hugging the playable rectangle. Replaces the bulky
  // frame asset overlay so balls remain visible at the edges.
  ctx.save();
  // Outer dark stroke (puyo silhouette)
  roundRect(ctx, x + 1.5, 1.5, w - 3, h - 3, 18, false, false);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1a0a2c';
  ctx.stroke();
  // Inner colored stroke
  roundRect(ctx, x + 4, 4, w - 8, h - 8, 15, false, false);
  ctx.lineWidth = 3;
  const rimGrad = ctx.createLinearGradient(x, 0, x, h);
  rimGrad.addColorStop(0, lightCol);
  rimGrad.addColorStop(1, darkCol);
  ctx.strokeStyle = rimGrad;
  ctx.stroke();
  // Top sheen (very thin highlight along inner top edge)
  ctx.beginPath();
  ctx.moveTo(x + 14, 8);
  ctx.lineTo(x + w - 14, 8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.restore();
}

function drawArenaInterior(x, y, w, h, light, dark) {
  // No inset — the dark fill covers the full physics rectangle so balls and
  // pegs at x≈0 / x≈BOARD_W aren't visually clipped.
  const innerX = x, innerY = y, innerW = w, innerH = h;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, innerX, innerY, innerW, innerH, 12, false, false);
  ctx.clip();
  // Radial vignette
  const grad = ctx.createRadialGradient(
    innerX + innerW / 2, innerY + innerH * 0.42, innerW * 0.18,
    innerX + innerW / 2, innerY + innerH / 2, Math.max(innerW, innerH) * 0.78
  );
  grad.addColorStop(0, lighten(light, 0.18));
  grad.addColorStop(0.55, light);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fillRect(innerX, innerY, innerW, innerH);
  // Top inner shadow
  const topShade = ctx.createLinearGradient(0, innerY, 0, innerY + 28);
  topShade.addColorStop(0, 'rgba(0,0,0,0.45)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(innerX, innerY, innerW, 28);
  // Bottom floor band
  const floorH = 20, floorY = innerY + innerH - floorH;
  const floorG = ctx.createLinearGradient(0, floorY, 0, innerY + innerH);
  floorG.addColorStop(0, 'rgba(0,0,0,0)');
  floorG.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = floorG;
  ctx.fillRect(innerX, floorY, innerW, floorH);
  ctx.restore();
}

function drawBoardFrame(x, y, w, h, sideColor, innerLight, innerDark, side) {
  // 1. Cast shadow (offset down-right)
  ctx.fillStyle = 'rgba(20,8,32,0.34)';
  roundRect(ctx, x + 2, y + 5, w, h, 24, true, false);

  // 2. Black outer ring — the thick "puyo black border"
  ctx.fillStyle = '#1a0a2c';
  roundRect(ctx, x, y, w, h, 24, true, false);

  // 3. Bright bevel band — top-light gradient on a colored ring
  const bevelGrad = ctx.createLinearGradient(0, y, 0, y + h);
  bevelGrad.addColorStop(0, lighten(sideColor, 0.55));
  bevelGrad.addColorStop(0.5, sideColor);
  bevelGrad.addColorStop(1, darken(sideColor, 0.40));
  ctx.fillStyle = bevelGrad;
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 21, true, false);

  // 4. Top white gloss strip across the colored band
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 21, false, false);
  ctx.clip();
  const glossGrad = ctx.createLinearGradient(0, y + 3, 0, y + 22);
  glossGrad.addColorStop(0, 'rgba(255,255,255,0.85)');
  glossGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glossGrad;
  ctx.fillRect(x + 3, y + 3, w - 6, 24);
  ctx.restore();

  // 5. Bottom inner shadow on the band
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 21, false, false);
  ctx.clip();
  const botShade = ctx.createLinearGradient(0, y + h - 18, 0, y + h);
  botShade.addColorStop(0, 'rgba(0,0,0,0)');
  botShade.addColorStop(1, 'rgba(0,0,0,0.40)');
  ctx.fillStyle = botShade;
  ctx.fillRect(x + 3, y + h - 18, w - 6, 18);
  ctx.restore();

  // 6. Inner black ring (defines edge between frame and arena)
  ctx.fillStyle = '#1a0a2c';
  roundRect(ctx, x + 9, y + 9, w - 18, h - 18, 16, true, false);

  // 7. Dark glass arena (radial vignette)
  const innerX = x + 11, innerY = y + 11, innerW = w - 22, innerH = h - 22;
  const grad = ctx.createRadialGradient(
    innerX + innerW / 2, innerY + innerH * 0.42, innerW * 0.18,
    innerX + innerW / 2, innerY + innerH / 2, Math.max(innerW, innerH) * 0.78
  );
  grad.addColorStop(0, lighten(innerLight, 0.18));
  grad.addColorStop(0.55, innerLight);
  grad.addColorStop(1, innerDark);
  ctx.fillStyle = grad;
  roundRect(ctx, innerX, innerY, innerW, innerH, 13, true, false);

  // 8. Top inner shadow (gives arena depth)
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, innerX, innerY, innerW, innerH, 13, false, false);
  ctx.clip();
  const topShade = ctx.createLinearGradient(0, innerY, 0, innerY + 28);
  topShade.addColorStop(0, 'rgba(0,0,0,0.55)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(innerX, innerY, innerW, 28);

  // 8b. Subtle inner glass sheen (top-left highlight)
  const sheen = ctx.createLinearGradient(innerX, innerY, innerX + innerW * 0.7, innerY + innerH * 0.7);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(innerX, innerY, innerW, innerH);

  // 8c. Floor band — implied ground at bottom of arena
  const floorH = 30;
  const floorY = innerY + innerH - floorH;
  const floorG = ctx.createLinearGradient(0, floorY, 0, innerY + innerH);
  floorG.addColorStop(0, 'rgba(0,0,0,0)');
  floorG.addColorStop(0.55, 'rgba(0,0,0,0.40)');
  floorG.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = floorG;
  ctx.fillRect(innerX, floorY, innerW, floorH);
  // Bright floor-line accent on top of the band
  const lineG = ctx.createLinearGradient(innerX, floorY, innerX + innerW, floorY);
  lineG.addColorStop(0,    'rgba(255,255,255,0)');
  lineG.addColorStop(0.5,  `rgba(255,255,255,0.32)`);
  lineG.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = lineG;
  ctx.fillRect(innerX, floorY, innerW, 1.4);
  // Side-tint floor (player blue / enemy pink) — very subtle
  const tintG = ctx.createLinearGradient(0, floorY, 0, innerY + innerH);
  tintG.addColorStop(0, 'rgba(255,255,255,0)');
  tintG.addColorStop(1, side === 'player' ? 'rgba(76,177,255,0.18)' : 'rgba(255,127,177,0.20)');
  ctx.fillStyle = tintG;
  ctx.fillRect(innerX, floorY, innerW, floorH);
  ctx.restore();

  // 9. Four rivets at corners (puyo arcade cabinet feel)
  const rivetPos = [
    [x + 12, y + 12],
    [x + w - 12, y + 12],
    [x + 12, y + h - 12],
    [x + w - 12, y + h - 12],
  ];
  for (const [rx, ry] of rivetPos) drawRivet(rx, ry, 3.4);
}

// Small metallic rivet (hex-y dot) — yellow brass against black.
function drawRivet(cx, cy, r) {
  // Outer black ring
  ctx.fillStyle = '#1a0a2c';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Brass body
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 0.4, cx, cy, r);
  g.addColorStop(0, '#fff7c4');
  g.addColorStop(0.5, '#ffd24a');
  g.addColorStop(1, '#a8501a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Tiny white dot
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

// 4-point sparkle star (simple kite shape, no path-cost spike)
function drawStar(cx, cy, size, points = 4) {
  const inner = size * 0.32;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? size : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(c, x, y, w, h, r, fill, stroke) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
  if (fill) c.fill();
  if (stroke) c.stroke();
}

function drawPuyoOrb(cx, cy, r, orbCfg, isCurrent) {
  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,.40)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.62, r * 0.90, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // Black outline (slightly outside body) — gives that thick puyo silhouette
  ctx.fillStyle = '#1a0a2c';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.fill();
  // Body gradient — bright white highlight upper-left, deep-saturate at edge
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r * 1.05);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.16, lighten(orbCfg.color, 0.55));
  grad.addColorStop(0.55, orbCfg.color);
  grad.addColorStop(1, darken(orbCfg.color, 0.35));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Top gloss arc — crescent shape
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  const glossGrad = ctx.createLinearGradient(0, cy - r, 0, cy);
  glossGrad.addColorStop(0, 'rgba(255,255,255,0.80)');
  glossGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glossGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.30, r * 0.78, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Bright pinpoint highlight
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.32, cy - r * 0.42, r * 0.22, r * 0.13, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Bottom-rim soft inner shadow (reads as plumpness)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
  ctx.clip();
  const rimGrad = ctx.createRadialGradient(cx, cy + r * 0.2, r * 0.4, cx, cy + r * 0.4, r * 1.1);
  rimGrad.addColorStop(0, 'rgba(0,0,0,0)');
  rimGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Puyo eyes — only when peg is large enough to read them
  if (r >= 7) {
    const eyeR = Math.max(1.6, r * 0.18);
    const eyeOff = r * 0.36;
    const eyeY = cy + r * 0.02;
    // White eye with thin black rim
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(cx - eyeOff, eyeY, eyeR + 2.0, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff, eyeY, eyeR + 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - eyeOff, eyeY, eyeR + 1.4, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff, eyeY, eyeR + 1.4, 0, Math.PI * 2);
    ctx.fill();
    // Pupils — slightly toward bottom-inside (puyo cute eye)
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(cx - eyeOff + eyeR * 0.18, eyeY + eyeR * 0.20, eyeR, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff + eyeR * 0.18, eyeY + eyeR * 0.20, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // Eye catchlight — tiny white dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - eyeOff + eyeR * 0.45, eyeY - eyeR * 0.10, eyeR * 0.36, 0, Math.PI * 2);
    ctx.arc(cx + eyeOff + eyeR * 0.45, eyeY - eyeR * 0.10, eyeR * 0.36, 0, Math.PI * 2);
    ctx.fill();
    // Tiny mouth (smile arc) — only for bigger orbs
    if (r >= 10) {
      ctx.strokeStyle = '#1a0a2c';
      ctx.lineWidth = Math.max(1.2, r * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.36, r * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }
  // Sparkle for current
  if (isCurrent) {
    const tt = (Date.now() % 1400) / 1400;
    const sparkleAlpha = (Math.sin(tt * Math.PI * 2) + 1) / 2 * 0.6 + 0.35;
    ctx.fillStyle = `rgba(255,255,255,${sparkleAlpha})`;
    const sx = cx + r * 0.7;
    const sy = cy - r * 0.62;
    drawSparkle(sx, sy, 3.2);
    ctx.fillStyle = `rgba(255,245,180,${sparkleAlpha * 0.7})`;
    drawSparkle(cx - r * 0.62, cy + r * 0.55, 1.8);
  }
}

// Tiny 4-point sparkle (helper for cannon orb glints)
function drawSparkle(sx, sy, ss) {
  ctx.beginPath();
  ctx.moveTo(sx, sy - ss);
  ctx.lineTo(sx + ss * 0.32, sy - ss * 0.32);
  ctx.lineTo(sx + ss, sy);
  ctx.lineTo(sx + ss * 0.32, sy + ss * 0.32);
  ctx.lineTo(sx, sy + ss);
  ctx.lineTo(sx - ss * 0.32, sy + ss * 0.32);
  ctx.lineTo(sx - ss, sy);
  ctx.lineTo(sx - ss * 0.32, sy - ss * 0.32);
  ctx.closePath();
  ctx.fill();
}

// Cannon rail — horizontal track running along the top of each arena, on which
// the cannon plate "slides". Two thick rails + tick marks at peg columns so the
// player feels they are aiming a moving launcher.
function drawCannonRail(boardX, side) {
  const isPlayer = side === 'player';
  const sideColor = isPlayer ? PALETTE.player : PALETTE.enemy;
  const railY = BOARD_TOP - 26;
  const x0 = boardX + 14;
  const x1 = boardX + BOARD_W - 14;
  const railH = 4;
  // Black silhouette
  ctx.fillStyle = '#1a0a2c';
  roundRect(ctx, x0 - 2, railY - 2, (x1 - x0) + 4, railH + 4, 3, true, false);
  // Bright bevel
  const railG = ctx.createLinearGradient(0, railY, 0, railY + railH);
  railG.addColorStop(0, lighten(sideColor, 0.55));
  railG.addColorStop(0.5, sideColor);
  railG.addColorStop(1, darken(sideColor, 0.35));
  ctx.fillStyle = railG;
  roundRect(ctx, x0, railY, x1 - x0, railH, 2, true, false);
  // Top bright sliver
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(x0 + 2, railY + 0.4, x1 - x0 - 4, 0.9);
  // End caps (dark with brass rivet)
  for (const xCap of [x0 - 2, x1 - 6]) {
    ctx.fillStyle = '#1a0a2c';
    roundRect(ctx, xCap, railY - 4, 8, railH + 8, 2, true, false);
    drawRivet(xCap + 4, railY + railH / 2, 1.7);
  }
  // 4 tick marks along the rail (column reference)
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  for (let i = 1; i < 5; i++) {
    const tx = x0 + ((x1 - x0) * i / 5);
    ctx.fillRect(tx - 0.5, railY + railH + 1, 1, 2.4);
  }
}

// Cannon — a chunky plastic launcher plate carrying the loaded orb above each
// board. Built from clamp arms (left/right brass clips), a base plate, the orb
// itself (with idle bounce), and an aim line that tracks the player's pointer.
function drawCannon(boardX, queue, side) {
  if (!queue[0]) return;
  const isPlayer = side === 'player';
  const orb = ORBS[queue[0]];
  // Enemy cannon glides toward its current aim X (set by enemyDropResponse)
  // so balls visibly drop from the cannon mouth instead of the board center.
  if (!isPlayer) {
    const targetX = state.enemyAimX != null ? state.enemyAimX : BOARD_W / 2;
    if (state.enemyCannonX == null) state.enemyCannonX = targetX;
    state.enemyCannonX += (targetX - state.enemyCannonX) * 0.18;
  }
  const cx = boardX + (isPlayer ? state.aimX : (state.enemyCannonX || BOARD_W / 2));
  // Idle bounce — only when actively aiming (player) or always for enemy.
  const bounce = (isPlayer && state.phase === 'aim')
    ? Math.sin((Date.now() % 1100) / 1100 * Math.PI * 2) * 1.2
    : Math.sin((Date.now() % 1500) / 1500 * Math.PI * 2) * 0.6;
  // Sit slightly below the rail (which is at BOARD_TOP - 26)
  const cy = BOARD_TOP - 14 + bounce;
  const cannonR = isPlayer ? BALL_R + 3 : BALL_R + 0.5;
  const sideColor = isPlayer ? PALETTE.player : PALETTE.enemy;

  // 0. Aim line — short, simple dotted line directly below the cannon. No reticle
  // (the cannon orb itself + its eyes already point the player at the column).
  if (isPlayer && state.phase === 'aim') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,245,180,0.55)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy + cannonR + 6);
    ctx.lineTo(cx, BOARD_BOTTOM - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 3. Cannon body image. Player: lap-varied turtle cannon (cycles every
  // playthrough). Enemy: per-stage character cannon.
  let bodyImg;
  if (isPlayer) {
    const lap = (state.playLap || 0) % ASSET.cannonPlayerByLap.length;
    bodyImg = ASSET.cannonPlayerByLap[lap]
      || ASSET.cannonBody[queue[0]];
  } else {
    bodyImg = ASSET.cannonEnemyByStage[state.stageIdx];
  }
  if (bodyImg && bodyImg.complete && bodyImg.naturalWidth > 0) {
    // Player turtle cannon native ~250×467 (barrel ~78%), enemy ~145×285 (barrel ~70%)
    const isEnemyCannon = !isPlayer;
    const aspect = isEnemyCannon ? (145 / 285) : (250 / 467);
    const barrelFrac = isEnemyCannon ? 0.70 : 0.78;
    const targetH = 100;
    const targetW = targetH * aspect;
    // Place barrel mouth at BOARD_TOP, body extends upward into tower zone
    const barrelMouthY = BOARD_TOP - 4;
    const imgTop = barrelMouthY - targetH * barrelFrac + bounce;
    ctx.drawImage(bodyImg, cx - targetW / 2, imgTop, targetW, targetH);
  } else {
    // Fallback halo + procedural ball if asset missing
    const haloA = isPlayer ? 0.42 : 0.20;
    const haloGrad = ctx.createRadialGradient(cx, cy - 1, 0, cx, cy - 1, cannonR + 9);
    haloGrad.addColorStop(0, `rgba(255,235,120,${haloA})`);
    haloGrad.addColorStop(1, 'rgba(255,235,120,0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy - 1, cannonR + 9, 0, Math.PI * 2);
    ctx.fill();
    drawPuyoOrb(cx, cy - 2, cannonR, orb, isPlayer);
  }

  // (Down-pointer arrow chevron removed — the cannon orb's eyes face the board
  // and the dotted aim line gives all the directional cue needed.)

  // (NEXT preview tag removed — cannon shows the loaded orb only; player keeps
  // attention on the falling balls instead of reading next-queue UI.)

  // 7. First-tap teaching cue — animated pill above player cannon
  if (isPlayer && state.firstTapHint && state.phase === 'aim') {
    const tapBounce = Math.sin((Date.now() % 700) / 700 * Math.PI * 2) * 2.5;
    const labelY = cy - cannonR - 28 + tapBounce;
    ctx.save();
    ctx.font = 'bold 13px "M PLUS Rounded 1c","Hiragino Maru Gothic ProN",ui-rounded,system-ui';
    const labelText = 'タップ!';
    const labelW = ctx.measureText(labelText).width + 22;
    // Black border
    ctx.fillStyle = '#1a0a2c';
    roundRect(ctx, cx - labelW / 2 - 1.5, labelY - 11, labelW + 3, 22, 11, true, false);
    // Yellow body
    const pillGrad = ctx.createLinearGradient(0, labelY - 10, 0, labelY + 10);
    pillGrad.addColorStop(0, '#fff7c4');
    pillGrad.addColorStop(0.5, '#ffd24a');
    pillGrad.addColorStop(1, '#ff9d3a');
    ctx.fillStyle = pillGrad;
    roundRect(ctx, cx - labelW / 2, labelY - 9.5, labelW, 19, 9.5, true, false);
    // Top sheen
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    roundRect(ctx, cx - labelW / 2 + 4, labelY - 8.5, labelW - 8, 4, 2, true, false);
    // Text
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(labelText, cx, labelY);
    ctx.fillText(labelText, cx, labelY);
    // Down arrow under pill
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.moveTo(cx - 6.5, labelY + 9);
    ctx.lineTo(cx + 6.5, labelY + 9);
    ctx.lineTo(cx, labelY + 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(cx - 5, labelY + 9.5);
    ctx.lineTo(cx + 5, labelY + 9.5);
    ctx.lineTo(cx, labelY + 15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function renderBoard(side, x0, pegs, balls, hitFlash) {
  // Board frame
  ctx.save();
  ctx.translate(x0, 0);
  // Hit flash overlay — soft pink, alpha capped to avoid blanking the board
  if (hitFlash > 0) {
    const a = Math.min(0.32, hitFlash * 0.45);
    ctx.fillStyle = `rgba(255,82,102,${a})`;
    ctx.fillRect(0, 0, BOARD_W, CANVAS_H);
  }
  // Pegs — prefer the official puyo asset when available; otherwise fall back
  // to fully drawn puyo style (black silhouette + radial gradient + eyes).
  // Subtle idle breath so the field feels alive.
  const breathT = PREFERS_REDUCED_MOTION ? 0 : (Math.sin(Date.now() / 720) * 0.04);
  for (const p of pegs) {
    if (!p.alive) continue;
    let scale = 1 + breathT;
    if (p.hitFlash > 0) scale *= 1 + p.hitFlash * 1.4;
    const baseColor = PEG_FILL[p.color];
    const r = PEG_R * scale;
    // Asset-based render path (blue/red/green logical colors only).
    const pegImg = ASSET.pegByColor[p.color];
    if (pegImg && pegImg.complete && pegImg.naturalWidth > 0) {
      // Soft white halo behind peg — separates it from the dark board fill
      const haloR = r * 1.45;
      const haloGrad = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, haloR);
      haloGrad.addColorStop(0, 'rgba(255,255,255,0.32)');
      haloGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
      ctx.fill();
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.62, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      const dia = (r + 1.5) * 2;
      ctx.drawImage(pegImg, p.x - dia / 2, p.y - dia / 2, dia, dia);
      // Hit flash halo on top
      if (p.hitFlash > 0) {
        const haloA = Math.min(0.7, p.hitFlash * 2.2);
        ctx.strokeStyle = `rgba(255,235,120,${haloA})`;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1 + p.hitFlash * 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    // ---- Fallback for white / heal / missing asset ----
    // Shadow underneath
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.62, r * 0.88, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Black silhouette outline (thick puyo border)
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 1.0, 0, Math.PI * 2);
    ctx.fill();
    // Body radial gradient
    const grad = ctx.createRadialGradient(p.x - r * 0.32, p.y - r * 0.42, r * 0.08, p.x, p.y, r * 1.05);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.16, lighten(baseColor, 0.55));
    grad.addColorStop(0.55, baseColor);
    grad.addColorStop(1, darken(baseColor, 0.40));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Crescent top gloss
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.92, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - r * 0.32, r * 0.78, r * 0.40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Pinpoint highlight
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.beginPath();
    ctx.ellipse(p.x - r * 0.32, p.y - r * 0.45, r * 0.22, r * 0.13, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Bottom inner shadow
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.95, 0, Math.PI * 2);
    ctx.clip();
    const rimG = ctx.createRadialGradient(p.x, p.y + r * 0.3, r * 0.4, p.x, p.y + r * 0.4, r * 1.1);
    rimG.addColorStop(0, 'rgba(0,0,0,0)');
    rimG.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = rimG;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Heal peg — white plus icon takes priority over eyes
    if (p.color === 'heal') {
      // White cross with black border
      ctx.strokeStyle = '#1a0a2c';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.55, p.y); ctx.lineTo(p.x + r * 0.55, p.y);
      ctx.moveTo(p.x, p.y - r * 0.55); ctx.lineTo(p.x, p.y + r * 0.55);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.55, p.y); ctx.lineTo(p.x + r * 0.55, p.y);
      ctx.moveTo(p.x, p.y - r * 0.55); ctx.lineTo(p.x, p.y + r * 0.55);
      ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (p.color === 'bomb') {
      // Bomb peg — black X with sparking pulse so the player reads "danger".
      const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 220 + p.x);
      ctx.strokeStyle = '#1a0a2c';
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.46, p.y - r * 0.46);
      ctx.lineTo(p.x + r * 0.46, p.y + r * 0.46);
      ctx.moveTo(p.x + r * 0.46, p.y - r * 0.46);
      ctx.lineTo(p.x - r * 0.46, p.y + r * 0.46);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.46, p.y - r * 0.46);
      ctx.lineTo(p.x + r * 0.46, p.y + r * 0.46);
      ctx.moveTo(p.x + r * 0.46, p.y - r * 0.46);
      ctx.lineTo(p.x - r * 0.46, p.y + r * 0.46);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // Tiny spark dots around the rim
      const sparkA = 0.35 + 0.25 * Math.sin(Date.now() / 180 + p.y);
      ctx.fillStyle = `rgba(255,235,120,${sparkA})`;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Date.now() / 360;
        const sx = p.x + Math.cos(a) * (r + 3) * pulse;
        const sy = p.y + Math.sin(a) * (r + 3) * pulse;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (r >= 5.0) {
      // Tiny puyo eyes — small black dots inside white
      const eyeR = Math.max(1.0, r * 0.20);
      const eyeOff = r * 0.36;
      const eyeY = p.y + r * 0.02;
      // White
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x - eyeOff, eyeY, eyeR + 0.6, 0, Math.PI * 2);
      ctx.arc(p.x + eyeOff, eyeY, eyeR + 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Pupil
      ctx.fillStyle = '#1a0a2c';
      ctx.beginPath();
      ctx.arc(p.x - eyeOff + eyeR * 0.15, eyeY + eyeR * 0.18, eyeR, 0, Math.PI * 2);
      ctx.arc(p.x + eyeOff + eyeR * 0.15, eyeY + eyeR * 0.18, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hit flash glow (soft yellow halo)
    if (p.hitFlash > 0) {
      const haloA = Math.min(0.7, p.hitFlash * 2.2);
      ctx.strokeStyle = `rgba(255,235,120,${haloA})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (1 + p.hitFlash * 2.2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Balls — puyo with squash & stretch + eyes + thick black silhouette
  for (const b of balls) {
    const orbCfg = ORBS[b.orb];
    // Squash & stretch — kept gentle so the landing zone reads cleanly
    const vRatio = Math.max(-1, Math.min(1, b.vy / 600));
    const sx = 1 - vRatio * 0.10;
    const sy = 1 + vRatio * 0.12;
    ctx.save();
    // Trail wisp behind ball (motion comet) — thin, just enough to imply speed
    if (b.vy > 320) {
      const trailA = Math.min(0.35, (b.vy - 320) / 800);
      const tg = ctx.createLinearGradient(b.x, b.y - BALL_R, b.x, b.y - BALL_R - 18);
      tg.addColorStop(0, `rgba(255,255,255,${trailA})`);
      tg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y - BALL_R - 8, BALL_R * 0.55, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Drop shadow under ball
    ctx.fillStyle = 'rgba(0,0,0,.36)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + BALL_R * 0.92, BALL_R * 0.92, BALL_R * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
    // Apply squash transform centered on ball
    ctx.translate(b.x, b.y);
    ctx.scale(sx, sy);
    // Black silhouette outer
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R + 1.2, 0, Math.PI * 2);
    ctx.fill();
    // Body gradient — strong puyo pop
    const bg = ctx.createRadialGradient(-BALL_R * 0.36, -BALL_R * 0.48, 0.5, 0, 0, BALL_R * 1.05);
    bg.addColorStop(0,    '#ffffff');
    bg.addColorStop(0.16, lighten(orbCfg.color, 0.55));
    bg.addColorStop(0.55, orbCfg.color);
    bg.addColorStop(1,    darken(orbCfg.color, 0.35));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // Crescent top gloss
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R * 0.92, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    ctx.ellipse(0, -BALL_R * 0.30, BALL_R * 0.78, BALL_R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Pinpoint highlight
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath();
    ctx.ellipse(-BALL_R * 0.32, -BALL_R * 0.46, BALL_R * 0.28, BALL_R * 0.16, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Bottom rim shadow (plumpness)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R * 0.95, 0, Math.PI * 2);
    ctx.clip();
    const rg = ctx.createRadialGradient(0, BALL_R * 0.25, BALL_R * 0.4, 0, BALL_R * 0.4, BALL_R * 1.1);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Puyo eyes
    const eyeR = BALL_R * 0.20;
    const eyeOff = BALL_R * 0.36;
    const eyeY = BALL_R * 0.04;
    // Eye black rim
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(-eyeOff, eyeY, eyeR + 1.6, 0, Math.PI * 2);
    ctx.arc( eyeOff, eyeY, eyeR + 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Eye white
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-eyeOff, eyeY, eyeR + 1.0, 0, Math.PI * 2);
    ctx.arc( eyeOff, eyeY, eyeR + 1.0, 0, Math.PI * 2);
    ctx.fill();
    // Pupil
    ctx.fillStyle = '#1a0a2c';
    ctx.beginPath();
    ctx.arc(-eyeOff + eyeR * 0.20, eyeY + eyeR * 0.20, eyeR, 0, Math.PI * 2);
    ctx.arc( eyeOff + eyeR * 0.20, eyeY + eyeR * 0.20, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // Catchlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-eyeOff + eyeR * 0.50, eyeY - eyeR * 0.10, eyeR * 0.35, 0, Math.PI * 2);
    ctx.arc( eyeOff + eyeR * 0.50, eyeY - eyeR * 0.10, eyeR * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Tiny mouth (open smile)
    ctx.strokeStyle = '#1a0a2c';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, BALL_R * 0.40, BALL_R * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // Star orb decorations — sparkle ring + 5-point star on the body
    if (b.orb === 'star') {
      const t = Date.now() / 320;
      ctx.save();
      ctx.rotate(t * 0.4);
      // 4 sparkles around the ball
      ctx.fillStyle = '#fff7c4';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rr = BALL_R + 3.2 + Math.sin(t + i) * 1.2;
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a) * rr;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // 5-point star centered on the ball, behind eyes are already drawn so
      // skip drawing star body — instead, just a yellow outline ring.
      ctx.strokeStyle = '#9a6e0a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, BALL_R - 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Spike orb decorations — small angular flames at 6 points
    if (b.orb === 'spike') {
      ctx.strokeStyle = '#1a0a2c';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Date.now() / 600;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * BALL_R, Math.sin(a) * BALL_R);
        ctx.lineTo(Math.cos(a) * (BALL_R + 4.2), Math.sin(a) * (BALL_R + 4.2));
        ctx.stroke();
      }
      ctx.strokeStyle = orbCfg.color;
      ctx.lineWidth = 1.0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Date.now() / 600;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * BALL_R, Math.sin(a) * BALL_R);
        ctx.lineTo(Math.cos(a) * (BALL_R + 3.6), Math.sin(a) * (BALL_R + 3.6));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---- INPUT ----
function pointerToCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * CANVAS_W / r.width,
    y: (e.clientY - r.top) * CANVAS_H / r.height,
  };
}

function aim(e) {
  const p = pointerToCanvas(e);
  if (p.x < PLAYER_X1) {
    // Player side
    const localX = p.x - PLAYER_X0;
    state.aimX = Math.max(BALL_R, Math.min(BOARD_W - BALL_R, localX));
  }
}

canvas.addEventListener('pointermove', aim);
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const p = pointerToCanvas(e);
  if (p.x < PLAYER_X1) {
    aim(e);
    playerDrop();
  }
});

document.querySelector('#reset').addEventListener('click', () => startStage(0));

// ---- ENDGAME ----
function onFinalVictory() {
  hideOverlay();
  const wins = load('peg-drop-vs-wins', 0) + 1;
  save('peg-drop-vs-wins', wins);
  const newClears = getStoredClearCount() + 1;
  localStorage.setItem('peg-drop:clears', String(newClears));
  const finalDlg = document.querySelector('#final-victory-dialog');
  const onClose = () => {
    finalDlg.removeEventListener('close', onClose);
    showUnlockThenRestart(newClears);
  };
  finalDlg.addEventListener('close', onClose);
  if (finalDlg.showModal) finalDlg.showModal();
}

// Detect unlocks crossed by the *new* clear count and surface them before the
// next adventure starts. Lap 1 introduces ボムペグ; lap 2 introduces スター玉.
function showUnlockThenRestart(lap) {
  const dlg = document.querySelector('#unlock-dialog');
  const unlocks = [];
  if (lap === BOMB_PEG_LAP) unlocks.push('bomb');
  if (lap === STAR_ORB_LAP) unlocks.push('star');
  if (!dlg || unlocks.length === 0) {
    startStage(0);
    return;
  }
  const list = dlg.querySelector('.unlock-list');
  if (list) {
    list.innerHTML = '';
    for (const k of unlocks) {
      const li = document.createElement('li');
      li.className = 'unlock-item';
      if (k === 'bomb') {
        li.innerHTML = '<span class="unlock-badge unlock-bomb">💥</span><div class="unlock-text"><strong>ボムペグ</strong>とうじょう！どの玉が当たっても <strong>大ばくはつ</strong>、まわりのペグもまきこんで一気にダメージがめ！</div>';
      } else if (k === 'star') {
        li.innerHTML = '<span class="unlock-badge unlock-star">★</span><div class="unlock-text"><strong>スター玉</strong>とうじょう！どの色のペグも壊せる <strong>万能玉</strong>がめ。たまに出るから狙いどころが大事！</div>';
      }
      list.appendChild(li);
    }
  }
  const onClose = () => {
    dlg.removeEventListener('close', onClose);
    startStage(0);
  };
  dlg.addEventListener('close', onClose);
  if (dlg.showModal) dlg.showModal();
  else startStage(0);
}

function onDefeat() {
  hideOverlay();
  const enemyNames = ['ぷにスライム', 'ふわゴースト', '黒幕'];
  resultTag.textContent = 'DEFEAT';
  resultTitle.textContent = '敗北';
  resultText.textContent = `${enemyNames[state.stageIdx]} に敗れた。もう一度挑戦しよう。`;
  if (dialog.showModal) dialog.showModal();
}

dialog.addEventListener('close', () => {
  // Defeat dialog: any close path (button or ESC) should restart so the
  // player is never stranded with a non-interactive board.
  startStage(0);
});

// ---- Hint bubble rotation ----
// えすけーぷがめ explains the rules across cycling messages.
const HINT_MESSAGES = [
  '<p><strong class="peg-blue">青の玉</strong>は <strong class="peg-blue">青ペグ</strong>を壊して相手にダメージがめ！</p>',
  '<p><strong class="peg-red">赤の玉</strong>は <strong class="peg-red">赤ペグ</strong>に強いがめ。BREAK で大ダメージ！</p>',
  '<p><strong class="peg-green">緑の玉</strong>は <strong class="peg-green">緑ペグ</strong>に当たると <strong>分裂</strong>して2発になるがめ〜</p>',
  '<p><strong class="peg-purple">紫(回復)ペグ</strong>に当てると <strong>HP +2</strong> がめ！ピンチで使うがめ〜</p>',
  '<p><strong class="peg-gray">グレーのペグ</strong>はどの玉でも 1 ダメージ。ただの中継地点がめ。</p>',
  '<p>同じ色の玉×ペグで <strong>BREAK</strong>ペグ消滅 +2dmg がめ！</p>',
  '<p>玉が動かなくなったら <strong>1秒で消える</strong>がめ。詰まりは怖くないがめ〜</p>',
  '<p>盤面の<strong>落としたい位置</strong>をタップすると玉がそこから落ちるがめ！</p>',
  '<p>盤面のペグはステージごとに配置が変わるがめ。よく見るがめ〜</p>',
];
const hintContent = document.querySelector('#hint-content');
const hintDots = document.querySelector('#hint-dots');
let hintIdx = 0;
function renderHintDots() {
  if (!hintDots) return;
  hintDots.innerHTML = '';
  for (let i = 0; i < HINT_MESSAGES.length; i++) {
    const s = document.createElement('span');
    if (i === hintIdx) s.className = 'on';
    hintDots.appendChild(s);
  }
}
function showHint(i) {
  if (!hintContent) return;
  hintIdx = ((i % HINT_MESSAGES.length) + HINT_MESSAGES.length) % HINT_MESSAGES.length;
  // Restart fade animation by toggling the parent class
  hintContent.style.animation = 'none';
  hintContent.offsetWidth;
  hintContent.style.animation = '';
  hintContent.innerHTML = HINT_MESSAGES[hintIdx];
  renderHintDots();
}
if (hintContent) {
  showHint(0);
  setInterval(() => showHint(hintIdx + 1), 4500);
  // Tap bubble to advance manually
  document.querySelector('#hint-bubble').addEventListener('click', (e) => {
    if (e.target.closest('.hint-hide')) return;
    showHint(hintIdx + 1);
  });
}

// ---- Hint show/hide toggle (persists in localStorage) ----
const hintRow = document.querySelector('#hint-row');
const hintHideBtn = document.querySelector('#hint-hide');
const hintShowBtn = document.querySelector('#hint-show');
const HINT_KEY = 'peg-drop:hint-collapsed';
function applyHintCollapsed(collapsed) {
  if (!hintRow) return;
  hintRow.classList.toggle('collapsed', collapsed);
}
applyHintCollapsed(localStorage.getItem(HINT_KEY) === '1');
if (hintHideBtn) hintHideBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  applyHintCollapsed(true);
  localStorage.setItem(HINT_KEY, '1');
});
if (hintShowBtn) hintShowBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  applyHintCollapsed(false);
  localStorage.setItem(HINT_KEY, '0');
});

// ---- INIT ----
state = { selectedOrb: 'round' };

// First-visit how-to-play dialog. Persists in localStorage so repeat
// players aren't pestered. Rules ("?" header button) is always available.
const introDlg = document.querySelector('#intro-dialog');
const INTRO_KEY = 'peg-drop:intro-seen';
function bootGame() {
  // Populate state via startStage *before* the render loop starts —
  // render() reads state.playerPegs/enemyPegs unconditionally, so the
  // raf loop must not run until those exist.
  startStage(0);
  requestAnimationFrame(loop);
}
if (introDlg && localStorage.getItem(INTRO_KEY) !== '1') {
  introDlg.addEventListener('close', () => {
    localStorage.setItem(INTRO_KEY, '1');
    bootGame();
  }, { once: true });
  if (introDlg.showModal) introDlg.showModal();
  else bootGame();
} else {
  bootGame();
}
