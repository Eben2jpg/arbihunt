# ArbiHunt Clone

Cross-exchange crypto arbitrage scanner with USDT (TRC-20 / BEP-20) payments.

## Architecture

- **Server**: Node.js + Express + CCXT v4 + WebSocket
  - Real-time scanner across 36 exchanges
  - Net profit scoring after fees, withdrawal cost, and liquidity
  - JWT auth, Free/PRO gating
- **Sliding session**: an account's email is recognized forever — returning users
  just log in (no re-signup). Sessions stay active while the user visits regularly,
  and a 72-hour gap without visiting forces a fresh sign-in.
  - USDT payment invoices with on-chain monitoring

- **Client**: React + Vite + Tailwind + React Router
  - Landing page, auth, dashboard, pricing, checkout, exchange status
  - WebSocket live feed

## Quick Start

```bash
# Install root + workspaces deps
npm install

# Start everything
npm run dev
```

Or start separately:
```bash
# Server (port 4000)
cd server && npm install && npm run dev

# Client (port 5173)
cd client && npm install && npm run dev
```

## Configuration

Copy `server/.env.example` to `server/.env` and edit:

```env
PORT=4000
JWT_SECRET=your-long-random-string
CLIENT_ORIGIN=http://localhost:5173

# Owner email: logging in with this email shows the Owner control panel
# in the dashboard to grant PRO to any account.
OWNER_EMAIL=you@example.com

# USDT payment addresses
USDT_TRON_ADDRESS=YourTRC20Address
USDT_BSC_ADDRESS=YourBEP20Address

# Optional: TRONGrid API key for faster TRC-20 monitoring
TRONGRID_API_KEY=

# Optional: BscScan API key
BSCSCAN_API_KEY=
```

## Plans (USDT)

- **PRO 1 week** — 7 USDT (7 days)
- **PRO 1 month** — 22 USDT (30 days)
- **PRO 1 year** — 240 USDT (365 days)

Free plan shows only opportunities under **1%** spread. PRO unlocks every
opportunity (1% and above) plus advanced filters and the profit calculator.

## Owner controls

- Set `OWNER_EMAIL` in `server/.env` to your email.
- Log in with that email → the **Owner control panel** appears in the dashboard
  where you can:
  - Upgrade any registered email to PRO (days, or blank = lifetime).
  - Turn your own account into lifetime PRO.
- CLI alternative: `node scripts/owner-upgrade.js <email> [days]` (from `server/`,
  omit days for lifetime).

## USDT Payments

- Invoices are generated for TRC-20 or BEP-20 USDT
- Checkout lets the user choose the TRC-20 or BEP-20 wallet and copy the deposit address
- On-chain monitor checks for incoming transfers every 60s
- PRO activates automatically after confirmations
- **Instant verification**: on checkout the user can paste their wallet's transaction
  hash (TXID) and `/api/payments/verify` confirms it on chain right away
- **Renewal**: payments are stacked on top of any remaining time, and PRO auto-expires
  at the exact day/time it was activated. A 24-hour countdown warning and a renewal
  prompt appear on the dashboard before/after the plan resets

## Exchanges Scanned

36 exchanges via CCXT: Binance, Bybit, OKX, KuCoin, Gate.io, MEXC, Bitget, HTX, Crypto.com, Bitfinex, Poloniex, WhiteBIT, HitBTC, Phemex, CoinEx, DigiFinex, Bitrue, LBank, XT.com, LATOKEN, BTSE, Toobit, Kraken, Bitstamp, BigONE, CEX.IO, Bitso, Bitbns, Indodax, ZebPay, BTCTurk, Coinone, Bithumb, Upbit, Coincheck, Bit2c.

## Notes

- Scanner uses public order-book data; no API keys required for exchanges
- The token universe is built **dynamically** from the union of every USDT market actually listed across all scanned exchanges (not a fixed seed list), so all listed tokens are compared each scan
- Order books are fetched in parallel with a rate-limit-aware pool; a scan lock prevents overlapping runs on large universes
- Free tier shows opportunities under 1% spread
- PRO unlocks every opportunity with advanced filters
- Checkout lets the user choose the TRC-20 or BEP-20 wallet, copy the deposit address, and PRO auto-activates after confirmations
- Not financial advice
