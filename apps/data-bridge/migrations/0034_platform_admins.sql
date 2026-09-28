-- Cozte's own team (superadmins): people who can open any organization in read-only mode for support. They are known
-- by their verified e-mail in Clerk; being a superadmin never makes them a member of the organizations they open.
CREATE TABLE platform_admins (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO platform_admins (email) VALUES ('matiasbarriga7@gmail.com');

-- Every time a superadmin opens an organization: who, which one and when.
CREATE TABLE platform_admin_access (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX platform_admin_access_org ON platform_admin_access (organization_id, started_at DESC);
