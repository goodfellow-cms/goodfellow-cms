-- When each connection's refresh token was last used, so the one before it
-- still works for a moment (REFRESH_GRACE_MS) when Claude asks again after an
-- answer it didn't get.
ALTER TABLE grants ADD COLUMN rotated_at INTEGER NOT NULL DEFAULT 0;
