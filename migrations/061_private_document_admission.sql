ALTER TABLE ai_invocation_admission DROP CONSTRAINT ai_invocation_admission_operation_check,
 ADD CONSTRAINT ai_invocation_admission_operation_check CHECK(operation IN
 ('conversation','active_work','vision','transcription','email_composition','direct_recap','private_recap','private_research','private_document'));
