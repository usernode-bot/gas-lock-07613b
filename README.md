# Gas & Lock

A single-page dashboard for crypto traders and DeFi users: watch gas fees
across chains, find the cheapest hours to transact, price a transaction
before sending it, and see which token unlocks are about to hit the market.

Everything runs client-side on **simulated demo data** — no live market
feeds, no backend writes. It is built to be fully interactive so every
button, filter, calculator and bookmark can be exercised immediately.

## What's in it

- **Header** — app title, a live status badge (marked "simulated"), and a
  global **Favorites only** switch that filters both sections.
- **Gas tracker** — live fee cards for Ethereum, Solana, Arbitrum and Base
  with green/amber/red level indicators; a weekly 7×24 fee heatmap per
  chain with a best-window hint; a cost calculator (token swap, NFT mint,
  cross-chain bridge) with chain, action and complexity inputs.
- **Lock tracker** — upcoming token unlocks (OP, ARB, SOL, APT, TIA,
  AVAX, STRK, SUI) with live countdowns, circulating-vs-locked supply
  bars, USD value at risk, a market-pressure rating, plus search and
  quick filters (All, Favorites, High risk, Next 7 days).
- **Favorites** — star any chain or token; stored in `localStorage`
  (`gaslock:favs.v1`, toggle in `gaslock:favonly.v1`) so preferences
  survive refreshes.

## Run it

```sh
npm ci --include=dev
npm run build   # compiles styles/tailwind-input.css to public/tailwind.css
npm start
```

The design kit lives in `styles/tailwind-input.css` (colour tokens +
components); `CLAUDE.md` documents the app's look and conventions.
