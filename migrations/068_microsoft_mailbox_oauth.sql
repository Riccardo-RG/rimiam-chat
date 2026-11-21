-- Keep all legacy Google grant IDs, ciphertext and delivery receipts in place.
ALTER TABLE google_oauth_request
  ADD COLUMN provider text NOT NULL DEFAULT 'google',
  ADD CONSTRAINT oauth_provider_capability CHECK (provider='google' OR (provider='microsoft' AND capability='email'));
ALTER TABLE google_credential
  ADD COLUMN provider text NOT NULL DEFAULT 'google',
  ADD CONSTRAINT credential_provider_capability CHECK (provider='google' OR (provider='microsoft' AND capability='email'));
