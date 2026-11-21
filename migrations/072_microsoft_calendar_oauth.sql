-- Extend existing credential bindings to permit separately consented calendar grants.
ALTER TABLE google_oauth_request DROP CONSTRAINT oauth_provider_capability,
  ADD CONSTRAINT oauth_provider_capability CHECK (provider IN ('google','microsoft') AND capability IN ('calendar','email'));
ALTER TABLE google_credential DROP CONSTRAINT credential_provider_capability,
  ADD CONSTRAINT credential_provider_capability CHECK (provider IN ('google','microsoft') AND capability IN ('calendar','email'));
