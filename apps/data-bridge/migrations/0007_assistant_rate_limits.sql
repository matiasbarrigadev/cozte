CREATE TABLE assistant_request_limits (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (
    (substr(bucket, 1, 7) = 'minute:' AND requests BETWEEN 0 AND 4)
    OR (substr(bucket, 1, 4) = 'day:' AND requests BETWEEN 0 AND 30)
  ),
  PRIMARY KEY (organization_id, user_id, bucket)
);
