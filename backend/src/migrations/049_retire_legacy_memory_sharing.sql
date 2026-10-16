-- O85: retire the pre-explicit global/bulk Friends Memory authority.
-- Explicit full_history_delayed_v1 grants remain untouched.

ALTER TABLE memory_share_grants
  MODIFY COLUMN revoked_reason
    ENUM('policy_disabled','unfriended','blocked','account_deleted','corrective','legacy_contract_retired') NULL;

UPDATE memory_share_policies
   SET enabled = 0,
       enabled_at = NULL,
       policy_epoch = policy_epoch + CASE WHEN enabled = 1 THEN 1 ELSE 0 END
 WHERE enabled = 1;

DELETE subscription
  FROM memory_subscriptions subscription
  JOIN memory_share_grants legacy
    ON legacy.owner_id = subscription.friend_id
   AND legacy.viewer_id = subscription.user_id
 WHERE legacy.status = 'active'
   AND legacy.coverage_scope = 'legacy_activity_since_grant'
   AND NOT EXISTS (
     SELECT 1
       FROM memory_share_grants current_grant
      WHERE current_grant.owner_id = subscription.friend_id
        AND current_grant.viewer_id = subscription.user_id
        AND current_grant.status = 'active'
        AND current_grant.revoked_at IS NULL
        AND current_grant.coverage_scope = 'full_history_delayed_v1'
   );

UPDATE memory_share_grants
   SET status = 'revoked',
       revoked_at = UTC_TIMESTAMP(3),
       revoked_reason = 'legacy_contract_retired',
       authorization_version = authorization_version + 1
 WHERE status = 'active'
   AND coverage_scope = 'legacy_activity_since_grant';
