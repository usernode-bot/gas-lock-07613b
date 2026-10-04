const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Mock market data ─────────────────────────────────────────────────────
// Everything the dashboard shows is simulated. Values come from a
// deterministic pseudo-random seed tied to the clock, so they drift over
// time like a live feed, yet every client loading in the same interval
// sees the same numbers (no flicker between a load and its 30-second
// refresh). No external API, no credentials, no database.
//
// `pg` stays in package.json for the day real chain data lands; nothing
// here touches Postgres yet.

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', unit: 'gwei', baseFee: 20, spread: 0.9, nativeUsd: 3210, flat: false, thresholds: { low: 15, high: 40 } },
  { id: 'solana', name: 'Solana', symbol: 'SOL', unit: 'SOL', baseFee: 0.000005, spread: 0.9, nativeUsd: 152, flat: true, thresholds: { low: 0.000004, high: 0.00001 } },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ARB', unit: 'gwei', baseFee: 0.1, spread: 0.9, nativeUsd: 3210, flat: false, thresholds: { low: 0.07, high: 0.2 } },
  { id: 'base', name: 'Base', symbol: 'ETH', unit: 'gwei', baseFee: 0.05, spread: 0.9, nativeUsd: 3210, flat: false, thresholds: { low: 0.04, high: 0.12 } },
];

// Standard gas units for a basic transfer, the basis of transferUsd and of
// the client's cost calculator. Solana charges a flat per-transaction fee
// instead and ignores it.
const TRANSFER_GAS = 21000;

// Upcoming unlocks, anchored to the current UTC day so the schedule stays
// put within a day: roughly 6 hours, 2, 4, 5, 9 and 14 days out.
const UNLOCK_TOKENS = [
  { id: 'arb', token: 'ARB', name: 'Arbitrum', hours: 6, amount: 92650000, circulating: 4280000000, locked: 5720000000 },
  { id: 'op', token: 'OP', name: 'Optimism', hours: 51, amount: 8500000, circulating: 1310000000, locked: 3790000000 },
  { id: 'apt', token: 'APT', name: 'Aptos', hours: 99, amount: 68300000, circulating: 1160000000, locked: 940000000 },
  { id: 'strk', token: 'STRK', name: 'Starknet', hours: 121, amount: 41000000, circulating: 2690000000, locked: 2410000000 },
  { id: 'wld', token: 'WLD', name: 'Worldcoin', hours: 220, amount: 5200000, circulating: 1350000000, locked: 3650000000 },
  { id: 'dydx', token: 'DYDX', name: 'dYdX', hours: 341, amount: 33000000, circulating: 1100000000, locked: 900000000 },
];

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 2147483647;
  return h;
}

// Deterministic 0..1 from an integer seed (integer-mixing PRNG — a plain
// `Math.sin(seed)` hash clusters badly at these seed sizes).
function rand(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function feeStatus(price, thresholds) {
  if (price < thresholds.low) return 'low';
  if (price > thresholds.high) return 'high';
  return 'medium';
}

// The current fee: the chain's base fee wobbling on a log scale by ±spread
// (spread 0.9 is roughly ×0.4..×2.5), seeded by the 5-minute bucket so it
// drifts between refreshes, not mid-page. Wide enough to cross the Low and
// High thresholds, so the status actually varies like a live feed.
function currentFee(chain) {
  const bucket = Math.floor(Date.now() / 300000);
  const wobble = Math.exp(chain.spread * (rand(hashSeed(chain.id) + bucket) - 0.5) * 2);
  return chain.baseFee * wobble;
}

function transferUsd(chain, price, gasUnits) {
  const cost = chain.flat ? price : (price * gasUnits) / 1e9;
  return cost * chain.nativeUsd;
}

function gasPayload() {
  const dayMs = 86400000;
  return {
    chains: CHAINS.map((chain) => {
      const price = currentFee(chain);
      const history = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(Date.now() - i * dayMs);
        const key = day.toISOString().slice(0, 10);
        // Each day's lowest fee, seeded by chain + calendar day so the past
        // week stays put within a day. Values span the chain's Low and
        // Medium bands; the status follows the same thresholds as now.
        const t = chain.thresholds;
        const value = t.low * 0.4 + (t.high - t.low * 0.4) * rand(hashSeed(chain.id + ':' + key));
        history.push({ date: key, low: value, status: feeStatus(value, t) });
      }
      return {
        id: chain.id,
        name: chain.name,
        symbol: chain.symbol,
        unit: chain.unit,
        price,
        status: feeStatus(price, chain.thresholds),
        nativeUsd: chain.nativeUsd,
        transferUsd: transferUsd(chain, price, TRANSFER_GAS),
        thresholds: chain.thresholds,
        history,
      };
    }),
  };
}

// Risk is the unlock's size relative to circulating supply: over 5% is
// high, 1–5% medium, under 1% low.
function unlockRisk(amount, circulating) {
  const share = amount / circulating;
  if (share > 0.05) return 'high';
  if (share >= 0.01) return 'medium';
  return 'low';
}

function unlocksPayload() {
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    unlocks: UNLOCK_TOKENS.map((t) => ({
      id: t.id,
      token: t.token,
      name: t.name,
      unlocksAt: new Date(dayStart + t.hours * 3600000).toISOString(),
      amount: t.amount,
      circulating: t.circulating,
      locked: t.locked,
      risk: unlockRisk(t.amount, t.circulating),
    })),
  };
}

// Gas fees and token unlocks. The dashboard refetches /api/gas every 30 s.
app.get('/api/gas', (_req, res) => res.json(gasPayload()));
app.get('/api/unlocks', (_req, res) => res.json(unlocksPayload()));

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/gas-lock-07613b/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/gas-lock-07613b/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
}

start().catch(err => { console.error(err); process.exit(1); });
