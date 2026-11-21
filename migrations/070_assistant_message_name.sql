-- Keep the public byline of a conversational reply at the time it was written.
ALTER TABLE message ADD COLUMN assistant_display_name text
 CHECK (assistant_display_name IS NULL OR (actor_kind='miriam' AND length(assistant_display_name) BETWEEN 1 AND 48));
