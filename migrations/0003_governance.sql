CREATE TABLE IF NOT EXISTS governance_votes (
 round_id TEXT NOT NULL, rules_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
 owner TEXT NOT NULL, candidate_id TEXT NOT NULL, weight_atomic TEXT NOT NULL,
 signature TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY (round_id, owner)
);
CREATE TABLE IF NOT EXISTS governance_proposals (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL, owner TEXT NOT NULL,
 theme TEXT NOT NULL, signature TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE (round_id, owner)
);
CREATE TABLE IF NOT EXISTS governance_rounds (
 id TEXT PRIMARY KEY CHECK (id = 'catalog'),
 commitments_json TEXT NOT NULL
);
