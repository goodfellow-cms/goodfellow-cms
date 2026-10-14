-- One row for each connection Claude has to the connector, so a refresh
-- token works once: using it moves the generation on, and an older one is
-- refused (and ends the connection), as OAuth requires for public clients.
-- Nothing else is kept: who it is and which sites are sealed in the tokens
-- Claude holds.
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_expires_at ON grants (expires_at);
