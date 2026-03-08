-- Polymarket Copy Trading Bot — initial schema
-- Run in Supabase SQL editor or via supabase db push

-- Traders we copy (from leaderboard/Predictfolio)
CREATE TABLE IF NOT EXISTS copied_traders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address       TEXT NOT NULL UNIQUE,
  label         TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Our copy-trading config (multipliers, limits)
CREATE TABLE IF NOT EXISTS copy_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_multiplier      NUMERIC DEFAULT 1.0,
  fetch_interval_sec    INTEGER DEFAULT 1,
  max_position_usd      NUMERIC,
  tiered_multipliers    JSONB,
  max_slippage_bps      INTEGER DEFAULT 50,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Snapshot of trader positions we use for diffing (Data API response cached)
CREATE TABLE IF NOT EXISTS trader_position_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  size            NUMERIC NOT NULL,
  avg_price       NUMERIC,
  raw_snapshot    JSONB,
  fetched_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (trader_address, market_slug, outcome)
);

-- Positions we have opened (mirror of trader positions)
CREATE TABLE IF NOT EXISTS our_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  token_id        TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  size            NUMERIC NOT NULL,
  avg_price       NUMERIC,
  cost_basis_usd   NUMERIC,
  source_trade_ids UUID[],
  opened_at       TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

-- Individual copy trades we executed (for history and aggregation)
CREATE TABLE IF NOT EXISTS copy_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  token_id        TEXT NOT NULL,
  side            TEXT NOT NULL,
  size            NUMERIC NOT NULL,
  price           NUMERIC NOT NULL,
  order_id        TEXT,
  clob_tx_hash    TEXT,
  status          TEXT DEFAULT 'pending',
  our_position_id UUID REFERENCES our_positions(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  filled_at       TIMESTAMPTZ
);

-- Optional: balance snapshots for sizing and analytics
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL,
  balance_usd  NUMERIC NOT NULL,
  snapshot_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trader_snapshots_trader_fetched
  ON trader_position_snapshots (trader_address, fetched_at);

CREATE INDEX IF NOT EXISTS idx_our_positions_trader_market
  ON our_positions (trader_address, market_slug);

CREATE INDEX IF NOT EXISTS idx_our_positions_closed_at
  ON our_positions (closed_at) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_copy_trades_trader_created
  ON copy_trades (trader_address, created_at);

CREATE INDEX IF NOT EXISTS idx_copy_trades_position
  ON copy_trades (our_position_id);

-- Enable RLS (optional: use service role in bot to bypass)
ALTER TABLE copied_traders ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_position_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE our_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY;

-- Policy: service role has full access; anon has none (default)
-- Bot uses SUPABASE_SERVICE_ROLE_KEY, so no extra policies needed for single-tenant.
