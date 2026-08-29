/* ================= Shooshdoku ================= */
'use strict';

/* ---------- persistence ---------- */
const DEFAULTS = {
  name: 'Shoosh', avatar: 8, frame: 0, sound: true, autoX: false,
  level: 1, totalScore: 0, game: null, streakDays: {}, streakBest: 0, coached: false,
  gamesPlayed: 0,
};
let S = load();
function load() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('shooshdoku') || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function save() { localStorage.setItem('shooshdoku', JSON.stringify(S)); }

const $ = id => document.getElementById(id);
const AVATARS = ['🐱', '🐼', '🐶', '🐊', '🐔', '🦆', '🦁', '😽', 'SHOOSH'];
const AVATAR_BG = ['#BDE3F0', '#DDEED8', '#FFE9A8', '#CBEBC4', '#CDE6F7', '#FFF3C9', '#F6C6C0', '#CBC4EE', '#CBB9F2'];
function avatarHTML(i) {
  return AVATARS[i] === 'SHOOSH' ? '<img class="avatar-img" src="./icons/shoosh-avatar.png" alt="Shoosh">' : AVATARS[i];
}
const FRAMES = 6; // f0..f5, f5 = golden (7-day streak)
const WIN_TITLES = n => [`Purrfect, ${n}!`, 'Meow-nificent!', `Paw-some, ${n}!`, 'Feline great!', 'Claw-ver girl!', `Whisker win, ${n}!`];
const WIN_NOTES = ['Not a single hairball 🐾', 'The cats are so proud of you', 'Somebody give her a fish 🐟', 'Smartest human in the house', 'Nap well earned 😴'];

/* ---------- audio ---------- */
let AC = null;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, when = 0, slide = 0) {
  if (!S.sound) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), c.currentTime + when + dur);
    g.gain.setValueAtTime(0, c.currentTime + when);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.05);
  } catch (e) {}
}
const sfx = {
  ui: () => tone(520, .06, 'triangle', .12),
  mark: () => tone(950, .05, 'triangle', .10),
  unmark: () => tone(420, .06, 'triangle', .09, 0, -120),
  place: () => { tone(660, .09, 'triangle', .16); tone(990, .12, 'triangle', .14, .07); },
  error: () => { tone(190, .18, 'square', .09); tone(140, .22, 'square', .08, .1); },
  refill: () => { tone(520, .08, 'triangle', .13); tone(660, .08, 'triangle', .13, .08); tone(880, .12, 'triangle', .13, .16); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .22, 'triangle', .15, i * .11)),
};

/* ---------- tiny utils ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shuffled(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- puzzle generator (daily + levels past 500) ---------- */
function genSolution(n, rng) {
  const cols = [], used = new Set();
  function bt(row) {
    if (row === n) return true;
    for (const c of shuffled([...Array(n).keys()], rng)) {
      if (used.has(c)) continue;
      if (row > 0 && Math.abs(cols[row - 1] - c) <= 1) continue;
      cols[row] = c; used.add(c);
      if (bt(row + 1)) return true;
      used.delete(c);
    }
    return false;
  }
  if (!bt(0)) return null;
  return cols.map((c, r) => r * n + c);
}
function growRegions(n, sol, rng) {
  const reg = new Array(n * n).fill(-1);
  const frontier = [];
  sol.forEach((idx, k) => { reg[idx] = k; frontier.push(idx); });
  let assigned = n;
  while (assigned < n * n) {
    const fi = (rng() * frontier.length) | 0;
    const cell = frontier[fi];
    const r = (cell / n) | 0, c = cell % n;
    const nbrs = [];
    if (r > 0 && reg[cell - n] === -1) nbrs.push(cell - n);
    if (r < n - 1 && reg[cell + n] === -1) nbrs.push(cell + n);
    if (c > 0 && reg[cell - 1] === -1) nbrs.push(cell - 1);
    if (c < n - 1 && reg[cell + 1] === -1) nbrs.push(cell + 1);
    if (!nbrs.length) { frontier.splice(fi, 1); continue; }
    const nb = nbrs[(rng() * nbrs.length) | 0];
    reg[nb] = reg[cell]; frontier.push(nb); assigned++;
  }
  return reg;
}
function countSolutions(n, reg, limit) {
  let count = 0;
  const colUsed = new Array(n).fill(false), regUsed = new Array(n).fill(false), cols = [];
  function bt(row) {
    if (count >= limit) return;
    if (row === n) { count++; return; }
    for (let c = 0; c < n; c++) {
      if (colUsed[c]) continue;
      if (row > 0 && Math.abs(cols[row - 1] - c) <= 1) continue;
      const g = reg[row * n + c];
      if (regUsed[g]) continue;
      colUsed[c] = regUsed[g] = true; cols[row] = c;
      bt(row + 1);
      colUsed[c] = regUsed[g] = false;
    }
  }
  bt(0);
  return count;
}
function generatePuzzle(n, seed) {
  const rng = mulberry32(seed);
  for (let att = 0; att < 30; att++) {
    const sol = genSolution(n, rng);
    if (!sol) continue;
    const reg = growRegions(n, sol, rng);
    if (countSolutions(n, reg, 2) === 1) return { n, reg, sol };
    if (att === 29) return { n, reg, sol }; // non-unique is fine: play is judged by completability
  }
}
// Find a full solution consistent with the given placed cats, or null.
function solveWith(n, reg, cats) {
  const colUsed = new Array(n).fill(false), regUsed = new Array(n).fill(false);
  const fixedByRow = new Array(n).fill(-1);
  for (const i of cats) {
    const r = (i / n) | 0, c = i % n;
    if (fixedByRow[r] !== -1 || colUsed[c] || regUsed[reg[i]]) return null;
    fixedByRow[r] = c; colUsed[c] = regUsed[reg[i]] = true;
  }
  for (const i of cats) { // adjacency among fixed cats
    for (const j of cats) {
      if (i >= j) continue;
      const ri = (i / n) | 0, ci = i % n, rj = (j / n) | 0, cj = j % n;
      if (Math.abs(ri - rj) <= 1 && Math.abs(ci - cj) <= 1) return null;
    }
  }
  const cols = new Array(n).fill(-1);
  function bt(row) {
    if (row === n) return true;
    if (fixedByRow[row] !== -1) {
      if (row > 0 && cols[row - 1] !== -1 && Math.abs(cols[row - 1] - fixedByRow[row]) <= 1) return false;
      cols[row] = fixedByRow[row];
      if (bt(row + 1)) return true;
      cols[row] = -1; return false;
    }
    for (let c = 0; c < n; c++) {
      if (colUsed[c]) continue;
      if (row > 0 && cols[row - 1] !== -1 && Math.abs(cols[row - 1] - c) <= 1) continue;
      if (row < n - 1 && fixedByRow[row + 1] !== -1 && Math.abs(fixedByRow[row + 1] - c) <= 1) continue;
      const g = reg[row * n + c];
      if (regUsed[g]) continue;
      colUsed[c] = regUsed[g] = true; cols[row] = c;
      if (bt(row + 1)) return true;
      colUsed[c] = regUsed[g] = false; cols[row] = -1;
    }
    return false;
  }
  if (!bt(0)) return null;
  return cols.map((c, r) => r * n + c);
}

/* ---------- level access ---------- */
function levelDef(num) { // 1-based
  if (num <= LEVELS.length) {
    const [n, g, sol, pre] = LEVELS[num - 1];
    return { n, reg: [...g].map(ch => parseInt(ch, 36)), sol: sol.slice(), pre: pre.slice() };
  }
  const n = 9 + (num % 2);
  const p = generatePuzzle(n, 0xBEEF ^ num * 2654435761);
  return { n: p.n, reg: p.reg, sol: p.sol, pre: [p.sol[(num % p.sol.length)]] };
}
function dailyDef(key) {
  const sizes = [7, 8, 9, 8, 7, 8, 9];
  const seed = hashStr('shoosh-' + key);
  const n = sizes[seed % 7];
  const p = generatePuzzle(n, seed);
  return { n: p.n, reg: p.reg, sol: p.sol, pre: [] };
}

/* ---------- streak ---------- */
function streakCurrent() {
  const d = new Date();
  let cur = 0;
  if (!S.streakDays[todayKey(d)]) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
  while (S.streakDays[todayKey(d)]) { cur++; d.setDate(d.getDate() - 1); }
  return cur;
}
function markDailyDone() {
  S.streakDays[todayKey()] = true;
  const cur = streakCurrent();
  if (cur > S.streakBest) S.streakBest = cur;
  save();
}

/* ---------- screens ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $('home-bg').classList.toggle('on', id === 'screen-home');
}
function overlay(id, on) { $(id).classList.toggle('show', on); }
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- home ---------- */
function renderHome() {
  $('home-avatar').innerHTML = avatarHTML(S.avatar);
  const ab = $('btn-profile');
  ab.className = 'avatar-btn f' + S.frame;
  ab.style.background = AVATAR_BG[S.avatar];
  $('home-streak').textContent = streakCurrent();
  $('home-score').textContent = S.totalScore.toLocaleString();
  $('btn-play').innerHTML = 'Level <span class="num">' + S.level + '</span>';
  const done = !!S.streakDays[todayKey()];
  $('btn-daily').classList.toggle('done', done);
  $('daily-sub').textContent = done ? '✓ done, see you tomorrow'
    : new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ---------- game state ---------- */
const G = {
  def: null, board: [], locked: new Set(), fishes: 3, score: 0,
  reveals: 3, autox: 3, daily: false, over: false, lastPlace: 0, painting: false, paintMoved: false,
};
const EMPTY = 0, X = 1, CAT = 2;
let scoreShown = 0, scoreAnim = null;

function startLevel(def, daily) {
  G.def = def; G.daily = daily; G.over = false;
  G.board = new Array(def.n * def.n).fill(EMPTY);
  G.locked = new Set(def.pre);
  def.pre.forEach(i => G.board[i] = CAT);
  G.fishes = 3; G.score = 0; G.reveals = 3; G.autox = 3; G.lastPlace = Date.now();
  // resume a saved in-progress game if it matches this level
  const sg = S.game;
  const resumed = sg && sg.daily === daily && sg.n === def.n &&
    (daily ? sg.dateKey === todayKey() : sg.num === G.levelNum);
  if (resumed) {
    G.board = sg.board.slice(); G.fishes = sg.fishes; G.score = sg.score;
    G.reveals = sg.reveals; G.autox = sg.autox;
  }
  if (!resumed) { S.gamesPlayed++; save(); }
  $('rules-banner').classList.toggle('collapsed', S.gamesPlayed > 2);
  scoreShown = 0;
  $('hud-mode').textContent = daily ? 'Daily' : 'Level';
  $('hud-level').textContent = daily ? new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : String(levelNumber());
  updateHud();
  buildBoard();
  overlay('win-overlay', false); overlay('lose-overlay', false);
  show('screen-game');
  requestAnimationFrame(fitBoard);
  if (resumed && G.fishes <= 0) {
    G.over = true;
    $('lose-remaining').textContent = def.n - G.board.filter(v => v === CAT).length;
    setTimeout(() => overlay('lose-overlay', true), 400);
  } else if (resumed && G.board.some((v, i) => v !== EMPTY && !G.locked.has(i))) {
    toast('Welcome back 🐾 right where you left off');
  }
  if (!S.coached) { setTimeout(() => toast('Tap once for ✕ · tap again to place a cat 🐈', 3600), 600); S.coached = true; save(); }
}
function persistGame() {
  S.game = G.over && G.fishes > 0 ? null : {
    daily: G.daily, num: G.daily ? 0 : G.levelNum, dateKey: todayKey(), n: G.def.n,
    board: G.board.slice(), fishes: G.fishes, score: G.score, reveals: G.reveals, autox: G.autox,
  };
  save();
}
function levelNumber() { return G.daily ? 0 : G.levelNum; }

function buildBoard() {
  const b = $('board'), n = G.def.n;
  b.innerHTML = '';
  b.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  for (let i = 0; i < n * n; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell c' + G.def.reg[i];
    cell.dataset.i = i;
    if (G.board[i] !== EMPTY) setCellArt(cell, G.board[i]);
    b.appendChild(cell);
  }
  refreshRegionsDone();
}
function setCellArt(cell, state) {
  cell.innerHTML = state === CAT ? '<svg><use href="#cat-happy"/></svg>'
    : state === X ? '<svg class="cx"><use href="#xmark"/></svg>' : '';
}
function fitBoard() {
  const wrap = document.querySelector('.board-wrap');
  const card = document.querySelector('.board-card');
  const size = Math.min(wrap.clientWidth, wrap.clientHeight, document.documentElement.clientWidth - 36, 470);
  card.style.width = size + 'px';
}
window.addEventListener('resize', () => { if ($('screen-game').classList.contains('active')) fitBoard(); });

function updateHud() {
  const n = G.def.n;
  const cats = G.board.filter(v => v === CAT).length;
  $('cat-count').textContent = cats + '/' + n;
  document.querySelectorAll('#fish-chip .fish-ico').forEach((f, i) => f.classList.toggle('lost', i >= G.fishes));
  $('reveal-count').textContent = G.reveals;
  $('autox-count').textContent = G.autox;
  $('btn-reveal').disabled = G.reveals <= 0;
  $('btn-autox').disabled = G.autox <= 0;
  animScore();
}
function animScore() {
  cancelAnimationFrame(scoreAnim);
  const el = $('hud-score');
  function step() {
    const diff = G.score - scoreShown;
    if (Math.abs(diff) < 1) { scoreShown = G.score; el.textContent = Math.round(scoreShown); return; }
    scoreShown += diff * 0.18;
    el.textContent = Math.round(scoreShown);
    scoreAnim = requestAnimationFrame(step);
  }
  step();
}

$('btn-rules').addEventListener('click', () => {
  sfx.ui();
  $('rules-banner').classList.toggle('collapsed');
  requestAnimationFrame(fitBoard);
});

/* ---------- board interaction ---------- */
const boardEl = $('board');
boardEl.addEventListener('pointerdown', e => {
  if (G.over) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  boardEl.setPointerCapture(e.pointerId);
  const i = +cell.dataset.i;
  if (G.locked.has(i)) { bumpCell(cell); return; }
  const st = G.board[i];
  if (st === EMPTY) { mark(i, cell); G.painting = true; }
  else if (st === X) tryPlaceCat(i, cell);
  else removeCat(i, cell);
});
boardEl.addEventListener('pointermove', e => {
  if (!G.painting || G.over) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el && el.closest && el.closest('.cell');
  if (!cell) return;
  const i = +cell.dataset.i;
  if (G.board[i] === EMPTY && !G.locked.has(i)) mark(i, cell);
});
['pointerup', 'pointercancel'].forEach(ev => boardEl.addEventListener(ev, () => { G.painting = false; }));
document.addEventListener('contextmenu', e => e.preventDefault());

function cellEl(i) { return boardEl.children[i]; }
function bumpCell(cell) { cell.classList.remove('pop'); void cell.offsetWidth; cell.classList.add('pop'); }

function mark(i, cell) { G.board[i] = X; setCellArt(cell, X); bumpCell(cell); sfx.mark(); persistGame(); }
function removeCat(i, cell) { G.board[i] = EMPTY; setCellArt(cell, EMPTY); sfx.unmark(); refreshRegionsDone(); updateHud(); persistGame(); }

function placedCats() { const out = []; G.board.forEach((v, i) => v === CAT && out.push(i)); return out; }
function tryPlaceCat(i, cell) {
  if (solveWith(G.def.n, G.def.reg, placedCats().concat(i))) {
    G.board[i] = CAT; setCellArt(cell, CAT); bumpCell(cell); sfx.place();
    const secs = (Date.now() - G.lastPlace) / 1000; G.lastPlace = Date.now();
    G.score += 250 + Math.max(0, Math.round(150 - secs * 15));
    if (S.autoX) autoMarkAround(i);
    refreshRegionsDone(); updateHud();
    const cats = G.board.filter(v => v === CAT).length;
    if (cats === G.def.n) win(); else persistGame();
  } else {
    mistake(i, cell);
  }
}
function mistake(i, cell) {
  sfx.error();
  cell.classList.remove('bad'); void cell.offsetWidth; cell.classList.add('bad');
  conflictsOf(i).forEach(j => { const c = cellEl(j); c.classList.remove('bad'); void c.offsetWidth; c.classList.add('bad'); });
  $('fish-chip').classList.remove('shake'); void $('fish-chip').offsetWidth; $('fish-chip').classList.add('shake');
  G.fishes--; G.score = Math.max(0, G.score - 100);
  G.board[i] = X; setCellArt(cell, X);
  updateHud();
  persistGame();
  if (G.fishes <= 0) {
    G.over = true;
    const remaining = G.def.n - G.board.filter(v => v === CAT).length;
    $('lose-remaining').textContent = remaining;
    setTimeout(() => overlay('lose-overlay', true), 650);
  }
}
function conflictsOf(i) {
  const n = G.def.n, r = (i / n) | 0, c = i % n, out = [];
  for (let j = 0; j < n * n; j++) {
    if (j === i || G.board[j] !== CAT) continue;
    const jr = (j / n) | 0, jc = j % n;
    if (jr === r || jc === c || G.def.reg[j] === G.def.reg[i] || (Math.abs(jr - r) <= 1 && Math.abs(jc - c) <= 1)) out.push(j);
  }
  return out;
}
function autoMarkAround(i) {
  const n = G.def.n, r = (i / n) | 0, c = i % n;
  for (let j = 0; j < n * n; j++) {
    if (G.board[j] !== EMPTY) continue;
    const jr = (j / n) | 0, jc = j % n;
    if (jr === r || jc === c || G.def.reg[j] === G.def.reg[i] || (Math.abs(jr - r) <= 1 && Math.abs(jc - c) <= 1)) {
      G.board[j] = X; setCellArt(cellEl(j), X);
    }
  }
}
function refreshRegionsDone() {
  const doneRegions = new Set();
  G.board.forEach((v, i) => { if (v === CAT) doneRegions.add(G.def.reg[i]); });
  G.board.forEach((v, i) => cellEl(i) && cellEl(i).classList.toggle('done', doneRegions.has(G.def.reg[i])));
}

/* ---------- powerups ---------- */
$('btn-reveal').addEventListener('click', () => {
  if (G.over || G.reveals <= 0) return;
  const sol = solveWith(G.def.n, G.def.reg, placedCats()) || G.def.sol;
  const target = sol.find(i => G.board[i] !== CAT);
  if (target == null) return;
  G.reveals--; sfx.place();
  G.board[target] = CAT;
  const cell = cellEl(target);
  setCellArt(cell, CAT); cell.classList.add('hinted'); bumpCell(cell);
  G.score += 100;
  if (S.autoX) autoMarkAround(target);
  refreshRegionsDone(); updateHud();
  if (G.board.filter(v => v === CAT).length === G.def.n) win(); else persistGame();
});
$('btn-autox').addEventListener('click', () => {
  if (G.over || G.autox <= 0) return;
  const cats = []; G.board.forEach((v, i) => v === CAT && cats.push(i));
  if (!cats.length) { toast('Place a cat first 🐈'); return; }
  G.autox--; sfx.mark();
  cats.forEach(autoMarkAround);
  updateHud();
  persistGame();
});

/* ---------- win / lose ---------- */
function win() {
  G.over = true;
  G.score += 200;
  S.totalScore += G.score;
  S.game = null;
  save();
  updateHud();
  sfx.win();
  confetti();
  const t = WIN_TITLES(S.name), notes = WIN_NOTES;
  $('win-title').textContent = t[(Math.random() * t.length) | 0];
  $('win-score').textContent = G.score;
  if (G.daily) {
    markDailyDone();
    $('win-note').textContent = 'Daily done! Streak: ' + streakCurrent() + ' 🐾';
    $('btn-next').textContent = 'See Streak';
  } else {
    $('win-note').textContent = notes[(Math.random() * notes.length) | 0];
    $('btn-next').textContent = 'Next Level';
    if (G.levelNum === S.level) { S.level++; save(); }
  }
  setTimeout(() => overlay('win-overlay', true), 700);
}
$('btn-next').addEventListener('click', () => {
  sfx.ui(); overlay('win-overlay', false);
  if (G.daily) { renderStreak(); show('screen-streak'); renderHome(); }
  else playLevel(S.level);
});
$('btn-win-home').addEventListener('click', () => { sfx.ui(); overlay('win-overlay', false); renderHome(); show('screen-home'); });
$('btn-refill').addEventListener('click', () => {
  sfx.refill(); G.fishes = 3; G.over = false; overlay('lose-overlay', false); updateHud();
  persistGame();
  toast('3 fresh fishes — no ads here, ever 💛');
});
$('btn-restart').addEventListener('click', () => {
  sfx.ui(); overlay('lose-overlay', false);
  S.game = null; save();
  if (G.daily) startLevel(dailyDef(todayKey()), true); else playLevel(G.levelNum);
});

/* ---------- confetti ---------- */
function confetti() {
  const cv = $('confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#EE8FA8', '#F5C56A', '#D96C8C', '#A98FD9', '#F5A0B0', '#FBEED6'];
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
    w: 6 + Math.random() * 7, h: 8 + Math.random() * 8,
    vy: 2.4 + Math.random() * 3.2, vx: -1.2 + Math.random() * 2.4,
    rot: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (t - t0 < 2600) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

/* ---------- navigation ---------- */
function playLevel(num) {
  G.levelNum = num;
  startLevel(levelDef(num), false);
}
$('btn-play').addEventListener('click', () => { sfx.ui(); playLevel(S.level); });
$('btn-daily').addEventListener('click', () => {
  sfx.ui();
  if (S.streakDays[todayKey()]) { renderStreak(); show('screen-streak'); return; }
  startLevel(dailyDef(todayKey()), true);
});
$('btn-back').addEventListener('click', () => { sfx.ui(); renderHome(); show('screen-home'); });
$('btn-streak').addEventListener('click', () => { sfx.ui(); renderStreak(); show('screen-streak'); });
$('btn-streak-back').addEventListener('click', () => { sfx.ui(); renderHome(); show('screen-home'); });

/* ---------- streak screen ---------- */
function renderStreak() {
  $('streak-current').textContent = streakCurrent();
  $('streak-best').textContent = S.streakBest;
  const row = $('week-row'); row.innerHTML = '';
  const names = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 1) % 7)); // back to Saturday
  for (let d = 0; d < 7; d++) {
    const date = new Date(start); date.setDate(start.getDate() + d);
    const key = todayKey(date);
    const div = document.createElement('div');
    div.className = 'day';
    const isToday = key === todayKey();
    const done = !!S.streakDays[key];
    if (isToday) div.classList.add('today');
    if (done) div.classList.add('done');
    const inner = done ? '<svg><use href="#paw"/></svg>' : (d === 6 ? '🎁' : '');
    div.innerHTML = `<span class="day-name">${names[d]}</span><div class="day-dot">${inner}</div>`;
    row.appendChild(div);
  }
}

/* ---------- profile ---------- */
let tmpAvatar = 0, tmpFrame = 0;
function openProfile() {
  tmpAvatar = S.avatar; tmpFrame = S.frame;
  $('name-input').value = S.name;
  buildAvatarGrid(); buildFrameGrid(); refreshPreview();
  switchTab(true);
  overlay('profile-overlay', true);
}
function refreshPreview() {
  const p = $('avatar-preview');
  p.innerHTML = avatarHTML(tmpAvatar);
  p.className = 'avatar-preview f' + tmpFrame;
  p.style.background = AVATAR_BG[tmpAvatar];
}
function buildAvatarGrid() {
  const g = $('avatar-grid'); g.innerHTML = '';
  AVATARS.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (i === tmpAvatar ? ' selected' : '');
    b.style.background = AVATAR_BG[i];
    b.innerHTML = avatarHTML(i) + '<span class="check">✓</span>';
    b.addEventListener('click', () => { sfx.ui(); tmpAvatar = i; buildAvatarGrid(); refreshPreview(); });
    g.appendChild(b);
  });
}
function buildFrameGrid() {
  const g = $('frame-grid'); g.innerHTML = '';
  const goldLocked = S.streakBest < 7;
  for (let i = 0; i < FRAMES; i++) {
    const b = document.createElement('button');
    const locked = i === 5 && goldLocked;
    b.className = 'tile f' + i + (i === tmpFrame ? ' selected' : '') + (locked ? ' locked' : '');
    b.style.background = AVATAR_BG[tmpAvatar];
    b.innerHTML = avatarHTML(tmpAvatar) + '<span class="check">✓</span>' + (locked ? '<span class="lock">🔒</span>' : '');
    b.addEventListener('click', () => {
      if (locked) { toast('Golden frame: 7-day streak ✨'); return; }
      sfx.ui(); tmpFrame = i; buildFrameGrid(); refreshPreview();
    });
    g.appendChild(b);
  }
}
function switchTab(avatar) {
  $('tab-avatar').classList.toggle('active', avatar);
  $('tab-frame').classList.toggle('active', !avatar);
  $('avatar-grid').classList.toggle('hidden', !avatar);
  $('frame-grid').classList.toggle('hidden', avatar);
}
$('tab-avatar').addEventListener('click', () => { sfx.ui(); switchTab(true); });
$('tab-frame').addEventListener('click', () => { sfx.ui(); switchTab(false); });
$('btn-profile').addEventListener('click', () => { sfx.ui(); openProfile(); });
$('profile-close').addEventListener('click', () => { sfx.ui(); overlay('profile-overlay', false); });
$('profile-confirm').addEventListener('click', () => {
  sfx.ui();
  S.avatar = tmpAvatar; S.frame = tmpFrame;
  const nm = $('name-input').value.trim();
  if (nm) S.name = nm;
  save(); renderHome();
  overlay('profile-overlay', false);
});

/* ---------- settings ---------- */
function openSettings() {
  $('opt-sound').checked = S.sound;
  $('opt-autox').checked = S.autoX;
  overlay('settings-overlay', true);
}
$('btn-settings').addEventListener('click', () => { sfx.ui(); openSettings(); });
$('btn-settings2').addEventListener('click', () => { sfx.ui(); openSettings(); });
$('settings-close').addEventListener('click', () => { sfx.ui(); overlay('settings-overlay', false); });
$('opt-sound').addEventListener('change', e => { S.sound = e.target.checked; save(); sfx.ui(); });
$('opt-autox').addEventListener('change', e => { S.autoX = e.target.checked; save(); sfx.ui(); });
$('btn-restart-level').addEventListener('click', () => {
  sfx.ui(); overlay('settings-overlay', false);
  if (!G.def) return;
  S.game = null; save();
  if (G.daily) startLevel(dailyDef(todayKey()), true); else playLevel(G.levelNum);
});
$('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset all progress? This cannot be undone.')) return;
  localStorage.removeItem('shooshdoku');
  S = load(); renderHome(); overlay('settings-overlay', false);
  toast('Fresh start 🐾');
});

/* dismiss overlays on backdrop tap */
['profile-overlay', 'settings-overlay'].forEach(id =>
  $(id).addEventListener('click', e => { if (e.target === $(id)) overlay(id, false); }));

/* ---------- petals, hearts & sparkles ---------- */
(function petals() {
  const cv = $('petals'), ctx = cv.getContext('2d');
  let W = 0, H = 0;
  function size() {
    W = innerWidth; H = innerHeight;
    cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  size(); addEventListener('resize', size);
  const PINKS = ['#F2A0B5', '#E87D9C', '#F5BCCB', '#D96C8C'];
  const petalsArr = Array.from({ length: 22 }, () => spawnPetal(true));
  const sparks = Array.from({ length: 10 }, spawnSpark);
  const hearts = [];
  function spawnPetal(anywhere) {
    return {
      x: Math.random() * W, y: anywhere ? Math.random() * H : -12,
      s: 4 + Math.random() * 5,
      vy: 0.35 + Math.random() * 0.65, vx: 0,
      sway: Math.random() * Math.PI * 2, swaySpd: 0.008 + Math.random() * 0.014,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.02,
      col: PINKS[(Math.random() * PINKS.length) | 0],
    };
  }
  function spawnSpark() {
    return { x: Math.random() * W, y: Math.random() * H * 0.6, t: Math.random() * Math.PI * 2, spd: 0.02 + Math.random() * 0.02, s: 2 + Math.random() * 2 };
  }
  function frame() {
    ctx.clearRect(0, 0, W, H);
    const homeActive = document.getElementById('screen-home').classList.contains('active');
    // petals fall everywhere, denser feel on home
    for (const p of petalsArr) {
      p.sway += p.swaySpd; p.rot += p.vr;
      p.x += Math.sin(p.sway) * 0.5; p.y += p.vy;
      if (p.y > H + 14) Object.assign(p, spawnPetal(false));
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = homeActive ? 0.9 : 0.45;
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.75);
      ctx.restore();
    }
    if (homeActive) {
      // twinkling pixel sparkles
      for (const sp of sparks) {
        sp.t += sp.spd;
        const a = (Math.sin(sp.t) + 1) / 2;
        if (a < 0.05 && Math.random() < 0.02) { sp.x = Math.random() * W; sp.y = Math.random() * H * 0.6; }
        ctx.globalAlpha = a * 0.85;
        ctx.fillStyle = '#FBEED6';
        ctx.fillRect(sp.x - sp.s / 2, sp.y - sp.s * 1.5, sp.s, sp.s * 3);
        ctx.fillRect(sp.x - sp.s * 1.5, sp.y - sp.s / 2, sp.s * 3, sp.s);
      }
      // occasional floating heart
      if (Math.random() < 0.008 && hearts.length < 4) {
        hearts.push({ x: W * (0.15 + Math.random() * 0.7), y: H * 0.85, vy: -0.5 - Math.random() * 0.3, s: 5 + Math.random() * 4, a: 1 });
      }
    }
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.y += h.vy; h.a -= 0.004;
      if (h.a <= 0) { hearts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(h.a, 0.9);
      ctx.fillStyle = '#E87D9C';
      const s = h.s; // pixel heart: two squares + body
      ctx.fillRect(h.x - s, h.y - s, s * 0.9, s * 0.9);
      ctx.fillRect(h.x + s * 0.1, h.y - s, s * 0.9, s * 0.9);
      ctx.fillRect(h.x - s * 1.4, h.y - s * 0.3, s * 2.8, s);
      ctx.fillRect(h.x - s * 0.9, h.y + s * 0.7, s * 1.8, s * 0.7);
      ctx.fillRect(h.x - s * 0.35, h.y + s * 1.4, s * 0.7, s * 0.5);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------- boot ---------- */
document.addEventListener('pointerdown', function unlock() { ac(); document.removeEventListener('pointerdown', unlock); }, { once: true });
renderHome();
$('home-bg').classList.add('on');
setTimeout(() => {
  const sp = $('splash');
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 600);
}, 1100);
const qs = new URLSearchParams(location.search);
if (qs.get('level')) playLevel(Math.max(1, +qs.get('level') || 1));
if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('./sw.js').catch(() => {});
