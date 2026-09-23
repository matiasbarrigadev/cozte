CREATE TABLE assistant_organization_request_limits (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  bucket TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (
    substr(bucket, 1, 4) = 'day:' AND requests BETWEEN 0 AND 1000
  ),
  PRIMARY KEY (organization_id, bucket)
);

INSERT INTO assistant_organization_request_limits (organization_id, bucket, requests)
SELECT organization_id, bucket,
  CASE WHEN SUM(requests) > 1000 THEN 1000 ELSE SUM(requests) END
FROM assistant_request_limits
WHERE bucket = 'day:' || date('now')
GROUP BY organization_id, bucket;

ALTER TABLE assistant_request_limits RENAME TO assistant_request_limits_previous;

CREATE TABLE assistant_request_limits (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (
    (substr(bucket, 1, 7) = 'minute:' AND requests BETWEEN 0 AND 10)
    OR (substr(bucket, 1, 4) = 'day:' AND requests BETWEEN 0 AND 30)
  ),
  PRIMARY KEY (organization_id, user_id, bucket)
);

INSERT INTO assistant_request_limits (organization_id, user_id, bucket, requests)
SELECT organization_id, user_id, bucket, requests
FROM assistant_request_limits_previous;

DROP TABLE assistant_request_limits_previous;
