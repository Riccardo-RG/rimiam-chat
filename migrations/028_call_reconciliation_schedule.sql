-- Operational polling schedule: retained unknown history does not busy-poll the provider.
ALTER TABLE audio_call ADD COLUMN next_reconcile_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX audio_call_reconcile_due ON audio_call(next_reconcile_at);
