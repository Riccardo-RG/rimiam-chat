-- Account-security delivery metadata, outside Workspace state/history. No plaintext bearer links in production jobs.
CREATE TABLE account_delivery (
 id uuid PRIMARY KEY, deduplication_key text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('verification','password-reset')),
 recipient text NOT NULL, encrypted_link text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','delivered','unknown','needs_configuration','expired')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, provider_delivery_id text, error_code text,
 delivered_at timestamptz
);
CREATE INDEX account_delivery_pending ON account_delivery(status,expires_at);
