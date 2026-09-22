import { assertExactKeys, assertPlainObject, assertUnique, invariant } from './common.mjs';

export const FIXTURE_RECEIPT_SCHEMA = 'cairnnz.external.fixture-receipt.v1';

function validateFixtureIdentity(value, field) {
  invariant(
    typeof value.runId === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.runId),
    'INVALID_FIXTURE_RUN_ID',
    `${field}.runId must be a canonical identifier`,
  );
  invariant(
    typeof value.namespace === 'string' && /^[a-z0-9][a-z0-9_]{2,63}$/.test(value.namespace),
    'INVALID_FIXTURE_NAMESPACE',
    `${field}.namespace must be a canonical fixture namespace`,
  );
  invariant(
    typeof value.database === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.database),
    'INVALID_FIXTURE_DATABASE',
    `${field}.database must be a canonical database identifier`,
  );
  invariant(
    typeof value.realm === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.realm),
    'INVALID_FIXTURE_REALM',
    `${field}.realm must be a canonical realm identifier`,
  );
}

export function validateFixtureReceipt(receipt, expected) {
  assertPlainObject(receipt, 'fixture receipt');
  assertExactKeys(receipt, ['schema', 'runId', 'namespace', 'database', 'realm', 'tables', 'rowKeys'], 'fixture receipt');
  invariant(receipt.schema === FIXTURE_RECEIPT_SCHEMA, 'INVALID_SCHEMA', 'fixture receipt schema mismatch');
  assertPlainObject(expected, 'expected fixture');
  assertExactKeys(expected, ['runId', 'namespace', 'database', 'realm', 'requiredTables'], 'expected fixture');
  validateFixtureIdentity(receipt, 'fixture receipt');
  validateFixtureIdentity(expected, 'expected fixture');
  for (const key of ['runId', 'namespace', 'database', 'realm']) {
    invariant(receipt[key] === expected[key], 'FIXTURE_SCOPE_MISMATCH', `fixture ${key} does not match expected scope`);
  }
  invariant(Array.isArray(expected.requiredTables), 'INVALID_REQUIRED_TABLES', 'requiredTables must be an array');
  for (const [index, table] of expected.requiredTables.entries()) {
    invariant(
      typeof table === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(table),
      'INVALID_REQUIRED_TABLES',
      `requiredTables[${index}] must be a canonical table identifier`,
    );
  }
  assertUnique(expected.requiredTables, 'requiredTables');
  invariant(Array.isArray(receipt.tables), 'INVALID_FIXTURE_TABLES', 'tables must be an array');
  const tableNames = receipt.tables.map((table, index) => {
    assertPlainObject(table, `tables[${index}]`);
    assertExactKeys(table, ['name', 'preexistingRows', 'createdRows'], `tables[${index}]`);
    invariant(typeof table.name === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(table.name), 'INVALID_FIXTURE_TABLE', 'table name must be a canonical identifier');
    invariant(Number.isSafeInteger(table.preexistingRows) && table.preexistingRows >= 0, 'INVALID_FIXTURE_COUNT', 'preexistingRows must be non-negative');
    invariant(Number.isSafeInteger(table.createdRows) && table.createdRows >= 0, 'INVALID_FIXTURE_COUNT', 'createdRows must be non-negative');
    invariant(table.preexistingRows === 0, 'FIXTURE_CONTAMINATION', `${table.name} had preexisting rows`);
    return table.name;
  });
  assertUnique(tableNames, 'fixture tables');
  invariant(
    tableNames.length === expected.requiredTables.length && tableNames.every((table) => expected.requiredTables.includes(table)),
    'INCOMPLETE_FIXTURE_SCOPE',
    'fixture tables must exactly match the required table inventory',
  );
  invariant(Array.isArray(receipt.rowKeys), 'INVALID_ROW_KEYS', 'rowKeys must be an array');
  const keys = receipt.rowKeys.map((rowKey, index) => {
    invariant(
      typeof rowKey === 'string' && /^[a-z0-9][a-z0-9_.:-]{2,255}$/.test(rowKey),
      'INVALID_ROW_KEY',
      `rowKeys[${index}] must be a canonical row identifier`,
    );
    invariant(rowKey.startsWith(`${receipt.namespace}:`), 'FIXTURE_NAMESPACE_ESCAPE', `row key is outside namespace: ${rowKey}`);
    return rowKey;
  });
  assertUnique(keys, 'fixture rowKeys');
  const createdRows = receipt.tables.reduce((sum, table) => sum + table.createdRows, 0);
  invariant(createdRows === keys.length, 'FIXTURE_ROW_CARDINALITY', 'created row count does not match unique row keys');
  return { namespace: receipt.namespace, tableCount: tableNames.length, createdRows };
}
