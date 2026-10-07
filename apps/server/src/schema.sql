CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  password_hash TEXT NOT NULL,
  bio VARCHAR(200) NOT NULL DEFAULT '',
  color VARCHAR(7) NOT NULL DEFAULT '#2563eb',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(240) NOT NULL DEFAULT '',
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('public', 'private')),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_code CHAR(32) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  client_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  reply_to_id BIGINT REFERENCES messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE(channel_id, author_id, client_id)
);
CREATE INDEX IF NOT EXISTS messages_channel_cursor_idx ON messages(channel_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING GIN(to_tsvector('simple', body));
INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;

INSERT INTO channels(id, name, description, kind, invite_code) VALUES
('00000000-0000-4000-8000-000000000001', 'Общее', 'Общий канал для общения и знакомства.', 'public', '00000000000000000000000000000001'),
('00000000-0000-4000-8000-000000000002', 'Разработка', 'Код, вопросы и обсуждение проекта.', 'public', '00000000000000000000000000000002'),
('00000000-0000-4000-8000-000000000003', 'Идеи', 'Что можно добавить в следующей версии?', 'public', '00000000000000000000000000000003')
ON CONFLICT(id) DO NOTHING;
