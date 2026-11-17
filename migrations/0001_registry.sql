CREATE TABLE IF NOT EXISTS configurations (
  version TEXT PRIMARY KEY,
  cluster TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  payment_mint TEXT NOT NULL,
  payment_program TEXT NOT NULL,
  fee_atomic TEXT NOT NULL,
  treasury TEXT NOT NULL,
  quote_decimals INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS launches (
  cluster TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  mint TEXT NOT NULL,
  signature TEXT NOT NULL,
  creator TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  payment_mint TEXT NOT NULL,
  payment_program TEXT NOT NULL,
  fee_atomic TEXT NOT NULL,
  treasury TEXT NOT NULL,
  config_version TEXT NOT NULL REFERENCES configurations(version),
  created_at INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster,mint),
  UNIQUE (cluster,signature)
);
CREATE INDEX IF NOT EXISTS launches_by_created ON launches(cluster,created_at DESC,mint);
