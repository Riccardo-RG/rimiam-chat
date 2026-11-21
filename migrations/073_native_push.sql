-- Browser registrations retain their existing transport, ciphertext and version.
ALTER TABLE web_push_device
  ADD COLUMN transport text NOT NULL DEFAULT 'web' CHECK (transport IN ('web','apns','fcm')),
  ADD COLUMN native_token_hash text,
  ADD COLUMN native_installation_hash text,
  ADD CHECK ((transport = 'web' AND native_token_hash IS NULL AND native_installation_hash IS NULL)
          OR (transport <> 'web' AND native_token_hash IS NOT NULL AND native_installation_hash IS NOT NULL));
CREATE UNIQUE INDEX native_push_active_token ON web_push_device (transport, native_token_hash)
  WHERE enabled AND transport <> 'web';
