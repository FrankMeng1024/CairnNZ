-- Rollback is safe only while no new client depends on causal selection
-- ordering. Remove the client/OTA first; never roll this table back while a
-- #34+ candidate is active.
DROP TABLE IF EXISTS memory_subscription_intent_heads;
