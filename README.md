# Polymarket Copy Trading Bot

Automated copy trading bot for Polymarket: mirrors trades from selected traders with proportional position sizing and real-time execution. Trade history is stored in **Supabase**.

## Features

- **Multi-trader support** — Copy multiple traders at once
- **Smart position sizing** — Scale by your balance vs. trader balance
- **Tiered multipliers** — Apply different multipliers by trade size
- **Real-time monitoring** — Polls Polymarket Data API (configurable interval)
- **Supabase** — All trades and positions persisted in PostgreSQL

## Prerequisites

- Node.js 20+
- [Supabase](https://supabase.com) project
- Polygon wallet with USDC and POL for gas
- Polygon RPC (e.g. [Alchemy](https://alchemy.com), [Infura](https://infura.io))

## Quick Start

### 1. Clone and install

```bash
cd polymarket-trading-bot
npm install
```

### 2. Environment

```bash
cp env.example .env
# Edit .env: USER_ADDRESSES, PROXY_WALLET, PRIVATE_KEY, SUPABASE_*, RPC_URL
```

### 3. Supabase schema

In the [Supabase SQL Editor](https://supabase.com/dashboard), run the contents of:

```
supabase/migrations/001_initial_schema.sql
```

### 4. Build and health check

```bash
npm run build
npm run health-check
```

### 5. Run

```bash
npm start
```

The bot runs the **monitor loop**: every `FETCH_INTERVAL` seconds it fetches each trader’s positions, diffs against the last snapshot, computes proportional sizes, aggregates small orders, and places orders on Polymarket. On the first run it only saves the current positions (no orders) so it doesn’t copy existing portfolios. Use Ctrl+C to stop gracefully.

## Configuration

| Variable | Description |
|----------|-------------|
| `USER_ADDRESSES` | Comma-separated trader addresses to copy |
| `PROXY_WALLET` | Your Polygon wallet (executes trades) |
| `PRIVATE_KEY` | Wallet private key (no 0x prefix) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (Settings → API) |
| `RPC_URL` | Polygon RPC endpoint |
| `TRADE_MULTIPLIER` | Global size multiplier (default 1.0) |
| `FETCH_INTERVAL` | Poll interval in seconds (default 1) |
| `MAX_SLIPPAGE_BPS` | Max slippage in basis points (default 50) |
| `MAX_SPREAD_BPS` | Optional: skip order if spread (ask−bid)/mid exceeds this (bps) |
| `MAX_POSITION_USD` | Optional: cap our size per position (USD) |
| `RECONCILE_INTERVAL_CYCLES` | Run position reconciliation every N cycles (default 60) |
| `TIERED_MULTIPLIERS` | Optional: JSON array `[{"min_usd", "max_usd", "mult"}]` by trade size |

You can also store traders in the `copied_traders` table and overrides in `copy_config` (see [implementation plan](docs/IMPLEMENTATION_PLAN.md)).

### Finding traders to copy

1. **Polymarket leaderboard** — [polymarket.com/leaderboard](https://polymarket.com/leaderboard); open a profile and copy the wallet address.
2. **Predictfolio** — Cross-check stats (win rate, P&L) and get addresses from linked profiles.
3. Add addresses to `USER_ADDRESSES` in `.env` or insert into Supabase `copied_traders` with `is_active = true`.

### Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the contents of `supabase/migrations/001_initial_schema.sql`.
3. In **Settings → API**, copy the project URL and the **service_role** key (keep it secret). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

### Run and stop

- **Start:** `npm start` — runs the monitor loop until you stop it.
- **Stop:** Ctrl+C once for graceful shutdown (finishes the current cycle and exits). Ctrl+C twice to force exit.

## Scripts

- `npm run build` — Compile TypeScript
- `npm run start` — Run the bot
- `npm run health-check` — Verify config, Supabase, RPC, and CLOB auth
- `npm run test-order` — Place a single test order (set `TEST_ORDER_TOKEN_ID`, optional: `TEST_ORDER_PRICE`, `TEST_ORDER_SIZE`, `TEST_ORDER_MARKET_SLUG`, `TEST_ORDER_OUTCOME`, `TEST_ORDER_TRADER_ADDRESS`)
- `npm run typecheck` — Type check without emit

### Docker

```bash
docker build -t polymarket-trading-bot .
docker run --env-file .env polymarket-trading-bot
```

Pass `.env` or set variables; ensure the app has network access to Polymarket and Supabase.

## Docs

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — Architecture, schema, and phases

## Disclaimer

For educational purposes only. Trading involves risk of loss. Use at your own risk.

## License

MIT
