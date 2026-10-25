-- Pages V1: personal creator pages. Safe to run once on top of 0001-0004.
CREATE TABLE pages (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  location TEXT,
  website TEXT,
  skills TEXT,
  layout TEXT NOT NULL DEFAULT 'cards',
  published INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE page_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link',
  position INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_page_links_user ON page_links(user_id, position);
CREATE TABLE page_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  url TEXT,
  thumb_url TEXT,
  position INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK (project_id IS NOT NULL OR (title IS NOT NULL AND url IS NOT NULL))
);
CREATE INDEX idx_page_projects_user ON page_projects(user_id, position);
CREATE UNIQUE INDEX idx_page_projects_unique ON page_projects(user_id, project_id) WHERE project_id IS NOT NULL;
