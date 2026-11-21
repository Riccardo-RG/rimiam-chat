-- Private email composition is budgeted without entering shared usage reports.
ALTER TABLE ai_invocation_admission DROP CONSTRAINT ai_invocation_admission_operation_check;
ALTER TABLE ai_invocation_admission ADD CONSTRAINT ai_invocation_admission_operation_check
 CHECK(operation IN ('conversation','active_work','vision','transcription','email_composition'));
