-- Sign in with Apple refresh tokens, kept only so they can be revoked when the account is
-- deleted (Apple requires it). Sealed with AES-GCM under a key derived from SESSION_SECRET
-- (src/crypto.ts), so a database copy alone does not reveal them. One per account, the newest
-- sign-in's; removed with the account.
CREATE TABLE apple_token (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_token_enc text NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE apple_token ENABLE ROW LEVEL SECURITY;
