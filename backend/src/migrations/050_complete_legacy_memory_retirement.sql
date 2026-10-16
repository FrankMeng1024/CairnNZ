-- O85: repair deployments where the 049 verifier recorded an empty-data
-- migration without first proving its schema postcondition.

ALTER TABLE memory_share_grants
  MODIFY COLUMN revoked_reason
    ENUM('policy_disabled','unfriended','blocked','account_deleted','corrective','legacy_contract_retired') NULL;
