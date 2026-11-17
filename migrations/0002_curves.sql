ALTER TABLE configurations ADD COLUMN launch_model TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE configurations ADD COLUMN curve_version TEXT;
ALTER TABLE configurations ADD COLUMN dbc_config TEXT;
ALTER TABLE configurations ADD COLUMN curve_json TEXT;
CREATE INDEX configurations_by_dbc ON configurations(cluster,dbc_config);
CREATE TABLE curve_configs (
  cluster TEXT NOT NULL CHECK (cluster IN ('devnet','mainnet-beta')),
  payment_mint TEXT NOT NULL,
  curve_version TEXT NOT NULL,
  config_address TEXT NOT NULL,
  signature TEXT NOT NULL,
  creator TEXT NOT NULL,
  platform_config_version TEXT NOT NULL REFERENCES configurations(version),
  policy_json TEXT NOT NULL,
  slot INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster,payment_mint,curve_version),
  UNIQUE (cluster,config_address),
  UNIQUE (cluster,signature)
);
ALTER TABLE launches ADD COLUMN model TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE launches ADD COLUMN pool TEXT;
ALTER TABLE launches ADD COLUMN curve_config TEXT;
ALTER TABLE launches ADD COLUMN initial_quote_atomic TEXT;
CREATE UNIQUE INDEX launches_by_pool ON launches(cluster,pool) WHERE pool IS NOT NULL;
