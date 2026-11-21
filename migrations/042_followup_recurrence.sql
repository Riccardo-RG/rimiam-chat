-- The version keeps the user's anchor and local rule. Only the operational
-- cursor advances on a delivery. Existing versions remain one-shot schedules.
ALTER TABLE followup_version
 ADD COLUMN recurrence_weekdays smallint[],
 ADD COLUMN recurrence_until date,
 ADD CONSTRAINT followup_recurrence_rule CHECK (
   (recurrence_weekdays IS NULL AND recurrence_until IS NULL) OR
   (recurrence_weekdays IS NOT NULL AND cardinality(recurrence_weekdays) BETWEEN 1 AND 7
     AND array_position(recurrence_weekdays,NULL) IS NULL
     AND recurrence_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
 );
ALTER TABLE workspace_followup ADD COLUMN next_remind_at timestamptz;
ALTER TABLE followup_delivery ADD COLUMN scheduled_at timestamptz;
-- Migrations are transactional. Populate the newly introduced key of old
-- receipts from the original immutable version without changing their outcome.
ALTER TABLE followup_delivery DISABLE TRIGGER immutable_record;
UPDATE followup_delivery d SET scheduled_at=v.remind_at FROM followup_version v
 WHERE (v.workspace_id,v.followup_id,v.version)=(d.workspace_id,d.followup_id,d.version);
ALTER TABLE followup_delivery ENABLE TRIGGER immutable_record;
ALTER TABLE followup_delivery ALTER COLUMN scheduled_at SET NOT NULL,
 DROP CONSTRAINT followup_delivery_pkey,
 ADD PRIMARY KEY(workspace_id,followup_id,version,scheduled_at),
 DROP CONSTRAINT followup_delivery_outcome_check,
 ADD CONSTRAINT followup_delivery_outcome_check CHECK (outcome IN ('delivered','suppressed','expired'));
UPDATE workspace_followup f SET next_remind_at=v.remind_at FROM followup_version v
 WHERE (f.workspace_id,f.id,f.current_version)=(v.workspace_id,v.followup_id,v.version)
 AND v.status='active' AND NOT EXISTS (
   SELECT 1 FROM followup_delivery d
   WHERE (d.workspace_id,d.followup_id,d.version)=(v.workspace_id,v.followup_id,v.version)
 );
CREATE INDEX workspace_followup_due ON workspace_followup(next_remind_at) WHERE next_remind_at IS NOT NULL;

-- Select at most eight local dates even after years offline. Apply the anchor's
-- wall-clock time to each date before converting to an instant, so normal DST
-- transitions do not drift. PostgreSQL resolves gaps/overlaps consistently.
-- On the anchor date honour the exact supplied instant, even in an overlap.
CREATE FUNCTION followup_next_occurrence(anchor timestamptz, zone_name text, weekdays smallint[],
 until_day date, after_at timestamptz DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
 WITH local_times AS (
   SELECT anchor AT TIME ZONE zone_name AS anchor_local,
          (after_at AT TIME ZONE zone_name)::date AS after_day
 ), dates AS (
   SELECT GREATEST(anchor_local::date, after_day) + n AS day, anchor_local
   FROM local_times CROSS JOIN generate_series(0,7) AS offsets(n)
 ), candidates AS (
   SELECT CASE WHEN day=anchor_local::date THEN anchor
               ELSE (day+anchor_local::time) AT TIME ZONE zone_name END AS instant
   FROM dates
   WHERE extract(isodow FROM day)::smallint=ANY(weekdays)
     AND (until_day IS NULL OR day<=until_day)
 )
 SELECT min(instant) FROM candidates WHERE after_at IS NULL OR instant>after_at
$$;
