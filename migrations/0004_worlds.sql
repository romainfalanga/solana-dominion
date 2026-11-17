CREATE TABLE IF NOT EXISTS world_registry (
  cluster TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  id TEXT NOT NULL,
  quote_mint TEXT NOT NULL,
  week INTEGER NOT NULL CHECK (week >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (cluster,id),
  UNIQUE (cluster,quote_mint),
  UNIQUE (cluster,week)
);
