# Polymarket Copy Trading Bot

Automated copy trading bot for Polymarket: mirrors trades from selected traders with proportional position sizing and real-time execution. Trade history is stored in **Supabase**.

## Features

- **Multi-trader support** — Copy multiple traders at once
- **Smart position sizing** — Scale by your balance vs. trader balance
- **Tiered multipliers** — Apply different multipliers by trade size
- **Real-time monitoring** — Polls Polymarket Data API (configurable interval)
- **Supabase** — All trades and positions persisted in PostgreSQL

## Prerequisites

- Node.js 18+
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

## Configuration

| Variable | Description |
|----------|-------------|
| `USER_ADDRESSES` | Comma-separated trader addresses to copy |
| `PROXY_WALLET` | Your Polygon wallet (executes trades) |
| `PRIVATE_KEY` | Wallet private key (no 0x prefix) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `RPC_URL` | Polygon RPC endpoint |
| `TRADE_MULTIPLIER` | Global size multiplier (default 1.0) |
| `FETCH_INTERVAL` | Poll interval in seconds (default 1) |
| `MAX_SLIPPAGE_BPS` | Max slippage in basis points (default 50) |

You can also store traders in the `copied_traders` table and overrides in `copy_config` (see [implementation plan](docs/IMPLEMENTATION_PLAN.md)).

## Scripts

- `npm run build` — Compile TypeScript
- `npm run start` — Run the bot
- `npm run health-check` — Verify config, Supabase, and RPC
- `npm run typecheck` — Type check without emit

## Docs

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — Architecture, schema, and phases

## Disclaimer

For educational purposes only. Trading involves risk of loss. Use at your own risk.

## License

MIT
