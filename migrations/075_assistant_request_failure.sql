-- NULL preserves the conservative fallback for failures recorded by older workers.
ALTER TABLE interpretation ADD COLUMN failed_explicit_request boolean;
