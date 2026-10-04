/* Gas & Lock — fully client-side, simulated data, no backend calls.
 *
 * Everything renders from the MOCK constants below. Fees random-walk every
 * few seconds; countdowns tick every second. Favorites and the "Favorites
 * only" toggle persist in localStorage under the keys at the bottom.
 *
 * Tailwind note: every class name is written as a whole literal, even inside
 * these template strings — the precompiled stylesheet's extractor is a regex
 * over this file's text and cannot see classes assembled at runtime.
 */

'use strict';

/* ── Mock data ──────────────────────────────────────────────────────────── */

const CHAINS = [
  {
    id: 'ethereum', name: 'Ethereum', mono: 'Ξ', tag: 'L1 · settlement',
    unit: 'Gwei', base: 18, low: 12, high: 35, evm: true,
    gasUnits: { swap: 168000, mint: 110000, bridge: 260000 },
    nativeSymbol: 'ETH', nativeUsd: 3180,
  },
  {
    id: 'solana', name: 'Solana', mono: '◎', tag: 'L1 · high throughput',
    unit: 'SOL', base: 0.0009, low: 0.0008, high: 0.0015, evm: false,
    fees: { swap: 0.0009, mint: 0.0006, bridge: 0.0012 },
    nativeSymbol: 'SOL', nativeUsd: 178,
  },
  {
    id: 'arbitrum', name: 'Arbitrum', mono: 'A', tag: 'L2 · optimistic rollup',
    unit: 'Gwei', base: 0.4, low: 0.3, high: 0.8, evm: true,
    gasUnits: { swap: 1300000, mint: 850000, bridge: 2000000 },
    nativeSymbol: 'ETH', nativeUsd: 3180,
  },
  {
    id: 'base', name: 'Base', mono: 'B', tag: 'L2 · Coinbase rollup',
    unit: 'Gwei', base: 0.12, low: 0.15, high: 0.35, evm: true,
    gasUnits: { swap: 1300000, mint: 850000, bridge: 2000000 },
    nativeSymbol: 'ETH', nativeUsd: 3180,
  },
];

// days: offset from page load, so countdowns and the "Next 7 days" filter
// always have live content no matter when this is opened.
const UNLOCKS = [
  { sym: 'OP', name: 'Optimism', days: 0.6, amount: 24.1e6, usd: 39.0e6, circPct: 62, pctOfSupply: 2.4, risk: 'High' },
  { sym: 'ARB', name: 'Arbitrum', days: 2.4, amount: 92.6e6, usd: 68.5e6, circPct: 42, pctOfSupply: 2.1, risk: 'High' },
  { sym: 'SOL', name: 'Solana', days: 3.3, amount: 480e3, usd: 85.4e6, circPct: 85, pctOfSupply: 0.6, risk: 'Medium' },
  { sym: 'APT', name: 'Aptos', days: 5.2, amount: 11.3e6, usd: 106.2e6, circPct: 58, pctOfSupply: 2.0, risk: 'High' },
  { sym: 'TIA', name: 'Celestia', days: 11.8, amount: 7.6e6, usd: 51.7e6, circPct: 38, pctOfSupply: 5.6, risk: 'High' },
  { sym: 'AVAX', name: 'Avalanche', days: 9.4, amount: 1.6e6, usd: 45.4e6, circPct: 47, pctOfSupply: 0.9, risk: 'Low' },
  { sym: 'STRK', name: 'Starknet', days: 18.6, amount: 64.0e6, usd: 24.3e6, circPct: 66, pctOfSupply: 3.2, risk: 'Medium' },
  { sym: 'SUI', name: 'Sui', days: 26.5, amount: 54.0e6, usd: 129.6e6, circPct: 32, pctOfSupply: 4.4, risk: 'High' },
].map((u) => ({ ...u, unlockAt: Date.now() + u.days * 86400000 }));

const ACTIONS = [
  { id: 'swap', label: 'Token swap' },
  { id: 'mint', label: 'NFT mint' },
  { id: 'bridge', label: 'Cross-chain bridge' },
];

const LEVEL = {
  low: { words: 'Low', pillBg: 'bg-pos/15', pillText: 'text-pos' },
  medium: { words: 'Medium', pillBg: 'bg-warn/15', pillText: 'text-warn' },
  high: { words: 'High', pillBg: 'bg-risk/15', pillText: 'text-risk' },
};

const RISK_WORDS = { Low: 'Low pressure', Medium: 'Medium pressure', High: 'High pressure' };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ── State ──────────────────────────────────────────────────────────────── */

const FAVS_KEY = 'gaslock:favs.v1';
const FAV_ONLY_KEY = 'gaslock:favonly.v1';

let favs = new Set(loadJson(FAVS_KEY, []));
let favOnly = localStorage.getItem(FAV_ONLY_KEY) === '1';
let lockFilter = 'all';
let searchQuery = '';
let hmChain = 'ethereum';
// Live fee values, walked every few seconds. Keyed by chain id.
const liveFee = Object.fromEntries(CHAINS.map((c) => [c.id, c.base * (0.85 + Math.random() * 0.3)]));
// Element refs for the per-second / per-tick updates.
const gasRefs = {};   // chain id -> { feeEl, pillEl, hintEl }
const cdRefs = {};    // token sym -> countdown element

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function isFav(id) {
  return favs.has(id);
}

function toggleFav(id) {
  if (favs.has(id)) favs.delete(id);
  else favs.add(id);
  localStorage.setItem(FAVS_KEY, JSON.stringify([...favs]));
  renderGas();
  renderLocks();
}

function setFavOnly(on) {
  favOnly = on;
  localStorage.setItem(FAV_ONLY_KEY, on ? '1' : '0');
  document.getElementById('fav-only').setAttribute('aria-pressed', String(on));
  renderGas();
  renderLocks();
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function starButton(favId, label) {
  const btn = el('button', 'star-btn');
  btn.dataset.fav = favId;
  btn.setAttribute('aria-pressed', String(isFav(favId)));
  btn.setAttribute('aria-label', (isFav(favId) ? 'Unstar ' : 'Star ') + label);
  btn.title = isFav(favId) ? 'Unstar' : 'Star';
  if (isFav(favId)) btn.classList.add('starred');
  btn.innerHTML =
    '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-5 w-5">' +
    '<path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 15l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z"/></svg>';
  return btn;
}

function pill(clsBg, clsText, words) {
  const p = el('span', 'pill ' + clsBg + ' ' + clsText, words);
  return p;
}

function feeLevel(chain, fee) {
  if (fee < chain.low) return 'low';
  if (fee < chain.high) return 'medium';
  return 'high';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtUsd(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 100) return '$' + Math.round(n).toLocaleString('en-US');
  return '$' + n.toFixed(2);
}

function fmtAmount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

function fmtFee(chain, v) {
  return chain.unit === 'SOL' ? v.toFixed(5) : v < 1 ? v.toFixed(2) : v.toFixed(1);
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'Unlocked';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return d + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(s);
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
  return m + ':' + pad(s);
}

function fmtUtcDate(ms) {
  const d = new Date(ms);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

// Deterministic pseudo-random in [0,1) from a string seed, so the heatmap is
// stable within a session and differs per chain / cell.
function hash01(seed) {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/* ── Section 1: gas tracker ─────────────────────────────────────────────── */

function renderGas() {
  const grid = document.getElementById('gas-grid');
  const empty = document.getElementById('gas-empty');
  grid.replaceChildren();
  for (const k of Object.keys(gasRefs)) delete gasRefs[k];

  const visible = CHAINS.filter((c) => !favOnly || isFav('chain:' + c.id));
  empty.hidden = visible.length > 0;
  grid.hidden = visible.length === 0;

  for (const chain of visible) {
    const card = el('article', 'glass flex flex-col gap-3 p-4');

    const head = el('div', 'flex items-start justify-between gap-2');
    const ident = el('div', 'flex items-center gap-2');
    const mono = el('span', 'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-raised text-small font-semibold text-cyan', chain.mono);
    const nameBox = el('div');
    nameBox.append(
      el('p', 'text-body font-semibold', chain.name),
      el('p', 'text-small text-muted', chain.tag),
    );
    ident.append(mono, nameBox);
    head.append(ident, starButton('chain:' + chain.id, chain.name));

    const feeRow = el('div', 'flex items-end justify-between gap-2');
    const feeEl = el('p', 'text-heading tabular-nums');
    const feeVal = el('span', undefined, fmtFee(chain, liveFee[chain.id]));
    const unit = el('span', 'text-small font-normal text-muted', ' ' + chain.unit);
    feeEl.append(feeVal, unit);
    const lvl = feeLevel(chain, liveFee[chain.id]);
    const pillEl = pill(LEVEL[lvl].pillBg, LEVEL[lvl].pillText, LEVEL[lvl].words);
    feeRow.append(feeEl, pillEl);

    const hintEl = el('p', 'text-small text-muted');
    hintEl.append('Swap ≈ ');
    const hintVal = el('span', 'text-cyan');
    hintEl.append(hintVal);

    card.append(head, feeRow, hintEl);
    grid.append(card);

    gasRefs[chain.id] = { feeVal, pillEl, hintVal };
    updateGasCard(chain);
  }
}

// Price a given action on a chain right now, in USD and native units.
function costFor(chain, actionId, mult, fee) {
  const f = fee !== undefined ? fee : liveFee[chain.id];
  let native;
  let detail;
  if (chain.evm) {
    const units = chain.gasUnits[actionId] * mult;
    native = units * f * 1e-9; // Gwei -> native token
    detail = Math.round(chain.gasUnits[actionId] * mult).toLocaleString('en-US') +
      ' gas × ' + fmtFee(chain, f) + ' Gwei × ' + chain.nativeSymbol + ' ' + fmtUsd(chain.nativeUsd);
  } else {
    native = chain.fees[actionId] * mult;
    detail = native.toFixed(5) + ' ' + chain.nativeSymbol + ' × ' + chain.nativeSymbol + ' ' + fmtUsd(chain.nativeUsd);
  }
  return { usd: native * chain.nativeUsd, detail };
}

function updateGasCard(chain) {
  const refs = gasRefs[chain.id];
  if (!refs) return;
  const fee = liveFee[chain.id];
  const lvl = feeLevel(chain, fee);
  refs.feeVal.textContent = fmtFee(chain, fee);
  refs.pillEl.className = 'pill ' + LEVEL[lvl].pillBg + ' ' + LEVEL[lvl].pillText;
  refs.pillEl.textContent = LEVEL[lvl].words;
  refs.hintVal.textContent = fmtUsd(costFor(chain, 'swap', 1).usd);
}

// Weekly heatmap: 7 days × 24 hours, 3-level status scale. Low-fee hours
// cluster at night and on weekends; a deterministic seed keeps a given cell
// stable for the session but different per chain.
function hmScore(chainId, dayIdx, hour) {
  const curve = [0.2, 0.1, 0.05, 0.05, 0.15, 0.4, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.5, 1.3, 1.1, 0.9, 0.8, 0.7, 0.5, 0.35, 0.25][hour];
  const weekend = dayIdx >= 5 ? 0.55 : 1;
  return curve * weekend * (0.55 + hash01(chainId + ':' + dayIdx + ':' + hour) * 0.75);
}

function hmLevel(score) {
  if (score > 1.25) return 'hi';
  if (score > 0.7) return 'md';
  return 'lo';
}

function hmGwei(chain, score) {
  return chain.base * (0.4 + score * 0.8);
}

function renderHeatmapChains() {
  const box = document.getElementById('hm-chains');
  box.replaceChildren();
  for (const chain of CHAINS) {
    const b = el('button', 'chip', chain.name);
    b.dataset.hm = chain.id;
    b.setAttribute('aria-pressed', String(chain.id === hmChain));
    box.append(b);
  }
}

function renderHeatmap() {
  const chain = CHAINS.find((c) => c.id === hmChain) || CHAINS[0];
  const wrap = document.getElementById('heatmap');
  wrap.replaceChildren();

  const grid = el('div', 'grid min-w-[320px] gap-[2px]');
  grid.style.gridTemplateColumns = '2.4rem repeat(24, minmax(0, 1fr))';

  // Header row: hour labels every 3 hours.
  grid.append(el('span'));
  for (let h = 0; h < 24; h++) {
    grid.append(el('span', h % 3 === 0 ? 'text-center text-[9px] leading-4 text-muted' : '', h % 3 === 0 ? String(h) : ''));
  }
  for (let d = 0; d < 7; d++) {
    grid.append(el('span', 'text-[9px] leading-4 text-muted', DAYS[d]));
    for (let h = 0; h < 24; h++) {
      const score = hmScore(chain.id, d, h);
      const lvl = hmLevel(score);
      const cell = el('span', 'hm-cell hm-' + lvl);
      cell.title = DAYS[d] + ' ' + pad(h) + ':00 · ~' + fmtFee(chain, hmGwei(chain, score)) + ' ' + chain.unit;
      grid.append(cell);
    }
  }
  wrap.append(grid);
  renderBestWindow(chain);
}

// Scan the next 7 days for the earliest stretch of two cheap hours.
function renderBestWindow(chain) {
  const now = new Date();
  const startHour = now.getUTCHours() + 1;
  const out = document.getElementById('hm-best');
  for (let i = 0; i < 24 * 7 - 1; i++) {
    const abs = startHour + i;
    const d = Math.floor(abs / 24) % 7;
    const h = abs % 24;
    const nextD = Math.floor((abs + 1) / 24) % 7;
    const nextH = (h + 1) % 24;
    if (hmLevel(hmScore(chain.id, d, h)) === 'lo' && hmLevel(hmScore(chain.id, nextD, nextH)) === 'lo') {
      const day = new Date(now.getTime() + (i + 1) * 3600000);
      out.textContent = 'Best window: ' + DAYS[day.getUTCDay() === 0 ? 6 : day.getUTCDay() - 1] +
        ' ' + pad(h) + ':00–' + pad((h + 2) % 24) + ':00 UTC';
      return;
    }
  }
  out.textContent = 'No cheap window found this week.';
}

/* ── Cost calculator ────────────────────────────────────────────────────── */

function renderCalcChains() {
  const sel = document.getElementById('calc-chain');
  sel.replaceChildren(...CHAINS.map((c) => new Option(c.name, c.id)));
}

function updateCalc() {
  const action = document.getElementById('calc-action').value;
  const chain = CHAINS.find((c) => c.id === document.getElementById('calc-chain').value) || CHAINS[0];
  const mult = parseFloat(document.getElementById('calc-size').value) || 1;
  const res = costFor(chain, action, mult);
  document.getElementById('calc-usd').textContent = fmtUsd(res.usd);
  document.getElementById('calc-breakdown').textContent = res.detail;

  // Cross-chain tip: the cheapest chain for this action right now.
  let best = null;
  for (const c of CHAINS) {
    const usd = costFor(c, action, mult).usd;
    if (!best || usd < best.usd) best = { name: c.name, usd };
  }
  document.getElementById('calc-tip').textContent =
    'Cheapest right now: ' + best.name + ' (' + fmtUsd(best.usd) + ')';
}

/* ── Section 2: lock tracker ────────────────────────────────────────────── */

function visibleUnlocks() {
  const q = searchQuery.trim().toLowerCase();
  const weekMs = 7 * 86400000;
  return UNLOCKS
    .filter((u) => {
      if (favOnly && !isFav('token:' + u.sym)) return false;
      if (lockFilter === 'favs' && !isFav('token:' + u.sym)) return false;
      if (lockFilter === 'risk' && u.risk !== 'High') return false;
      if (lockFilter === 'week' && u.unlockAt - Date.now() > weekMs) return false;
      if (q && !(u.sym.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => a.unlockAt - b.unlockAt);
}

function renderLocks() {
  const grid = document.getElementById('locks-grid');
  const empty = document.getElementById('locks-empty');
  grid.replaceChildren();
  for (const k of Object.keys(cdRefs)) delete cdRefs[k];

  const list = visibleUnlocks();
  document.getElementById('locks-count').textContent =
    list.length + ' of ' + UNLOCKS.length + ' upcoming unlocks';
  empty.hidden = list.length > 0;
  grid.hidden = list.length === 0;

  if (!list.length) {
    const q = searchQuery.trim();
    const anyFav = UNLOCKS.some((u) => isFav('token:' + u.sym));
    document.getElementById('locks-empty-title').textContent = q
      ? 'No unlocks match "' + q + '"'
      : 'No unlocks in this filter';
    document.getElementById('locks-empty-body').textContent = (lockFilter === 'favs' || (favOnly && !anyFav))
      ? 'Tap the star on a token card to pin it here.'
      : 'Try a different search or filter.';
    return;
  }

  for (const u of list) {
    const card = el('article', 'glass relative flex flex-col gap-3 p-4');

    const head = el('div', 'flex items-center gap-3 pr-10');
    head.append(
      el('span', 'grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-raised text-small font-semibold text-cyan', u.sym),
    );
    const nameBox = el('div', 'min-w-0');
    nameBox.append(
      el('p', 'text-body font-semibold', u.name),
      el('p', 'text-small text-muted', 'Unlocks ' + fmtUtcDate(u.unlockAt)),
    );
    head.append(nameBox);
    card.append(head, starButton('token:' + u.sym, u.name));

    const cdBox = el('div');
    const cdEl = el('p', 'text-heading tabular-nums', 'in ' + fmtCountdown(u.unlockAt - Date.now()));
    cdEl.dataset.cd = u.sym;
    cdBox.append(el('p', 'text-small text-muted', 'Countdown'), cdEl);
    card.append(cdBox);
    cdRefs[u.sym] = cdEl;

    const amountRow = el('div', 'flex items-end justify-between gap-2');
    amountRow.append(
      el('p', 'text-body', fmtAmount(u.amount) + ' ' + u.sym),
      el('p', 'text-body tabular-nums text-cyan', '~' + fmtUsd(u.usd)),
    );
    card.append(amountRow);

    const meterBox = el('div');
    const meter = el('div', 'meter');
    const fill = el('span');
    fill.style.width = u.circPct + '%';
    meter.append(fill);
    const labels = el('div', 'mt-1 flex justify-between text-small text-muted');
    labels.append(
      el('span', undefined, 'Circulating ' + u.circPct + '%'),
      el('span', undefined, 'Locked ' + (100 - u.circPct) + '%'),
    );
    meterBox.append(meter, labels);
    card.append(meterBox);

    const foot = el('div', 'flex items-center justify-between gap-2');
    foot.append(
      pill(LEVEL[u.risk.toLowerCase()].pillBg, LEVEL[u.risk.toLowerCase()].pillText, RISK_WORDS[u.risk]),
      el('span', 'text-small text-muted', u.pctOfSupply.toFixed(1) + '% of supply'),
    );
    card.append(foot);
    grid.append(card);
  }
}

function tickCountdowns() {
  const now = Date.now();
  for (const u of UNLOCKS) {
    const ref = cdRefs[u.sym];
    if (ref) ref.textContent = 'in ' + fmtCountdown(u.unlockAt - now);
  }
}

/* ── Live fee walk ──────────────────────────────────────────────────────── */

function tickFees() {
  for (const chain of CHAINS) {
    const jitter = chain.base * 0.12;
    let next = liveFee[chain.id] + (Math.random() - 0.5) * 2 * jitter;
    next = Math.min(chain.base * 2.2, Math.max(chain.base * 0.4, next));
    liveFee[chain.id] = next;
    updateGasCard(chain);
  }
  updateCalc();
}

/* ── Events ─────────────────────────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  const star = e.target.closest('[data-fav]');
  if (star) {
    toggleFav(star.dataset.fav);
    return;
  }
  const hm = e.target.closest('[data-hm]');
  if (hm) {
    hmChain = hm.dataset.hm;
    renderHeatmapChains();
    renderHeatmap();
    return;
  }
  const chip = e.target.closest('#lock-filters [data-filter]');
  if (chip) {
    lockFilter = chip.dataset.filter;
    for (const c of document.querySelectorAll('#lock-filters [data-filter]')) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    renderLocks();
  }
});

document.getElementById('fav-only').addEventListener('click', function () {
  setFavOnly(this.getAttribute('aria-pressed') !== 'true');
});

document.getElementById('token-search').addEventListener('input', function () {
  searchQuery = this.value;
  renderLocks();
});

for (const id of ['calc-action', 'calc-chain', 'calc-size']) {
  document.getElementById(id).addEventListener('change', updateCalc);
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

setFavOnly(favOnly);
renderHeatmapChains();
renderHeatmap();
renderCalcChains();
updateCalc();
renderGas();
renderLocks();
setInterval(tickFees, 4000);
setInterval(tickCountdowns, 1000);
