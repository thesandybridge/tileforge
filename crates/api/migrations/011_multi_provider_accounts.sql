-- Provider accounts table
CREATE TABLE accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    username            TEXT,
    avatar_url          TEXT,
    email               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider, provider_account_id)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);

-- Migrate existing GitHub users into accounts table
INSERT INTO accounts (user_id, provider, provider_account_id, username, avatar_url, email)
SELECT id, 'github', github_id::text, username, avatar_url, email
FROM users WHERE github_id IS NOT NULL;

-- Make github_id nullable (stop using, keep for safety)
ALTER TABLE users ALTER COLUMN github_id DROP NOT NULL;
