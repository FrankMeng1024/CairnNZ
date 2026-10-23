-- Guarded rollback for migration 057. Diagnostics are derived QA evidence.
DROP TABLE IF EXISTS diagnostic_batches;
DROP TABLE IF EXISTS diagnostic_streams;
DROP TABLE IF EXISTS diagnostic_qa_enrollments;
