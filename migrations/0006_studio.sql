-- AI Studio V1: conversations and messages. Safe to run once on top of 0001-0005.
CREATE TABLE studio_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_studio_conv_user ON studio_conversations(user_id, updated_at DESC);
CREATE TABLE studio_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_studio_msg_conv ON studio_messages(conversation_id, created_at);
