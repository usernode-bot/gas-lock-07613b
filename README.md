# Gas & Lock

A single-page dashboard for timing transactions and watching token
unlocks, built on Homeroom.

## What it shows

- **Gas fees** — a card per chain (Ethereum, Solana, Arbitrum, Base)
  with the current fee, a color-coded Low/Medium/High status, a meter
  toward the chain's high-fee mark and what a standard transfer costs
  in USD. The numbers drift and refresh every 30 seconds.
- **Weekly low-fee heatmap** — the past 7 days of each chain's lowest
  fee, one row per chain, colored by status.
- **Cost calculator** — pick a chain and a transaction kind (Transfer,
  Approve, Swap) or type your own gas-units number, and see the cost in
  USD at that chain's current fee. Solana charges a flat per-
  transaction fee instead, so its presets are hidden.
- **Token unlocks** — upcoming unlocks with countdown timers,
  circulating-vs-locked supply bars and a market-impact risk rating.

Every chain and token can be starred. A **Starred only** switch filters
both sections down to the starred items. Favorites and the switch are
kept in the browser (localStorage), not on a server.

**All data is mock.** The numbers are generated in code to feel like a
live feed — there is no connection to any chain or market API and no
database table. The endpoints are `/api/gas` and `/api/unlocks`, and
the header badge says "Demo data" for the same reason.

## How it's built

Express serves the shell and the two JSON endpoints; the UI is one
static page styled entirely with the app's design kit. Tailwind is
precompiled: `npm run build` compiles `styles/tailwind-input.css` to
`public/tailwind.css` on every image build. No dependencies beyond the
template's, no database. Sign-in is handled by the Homeroom platform.
