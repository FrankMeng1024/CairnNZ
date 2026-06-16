#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * run-migration.js — v0.2.5 backend migration runner
 *
 * Usage:
 *   node backend/scripts/run-migration.js apply 015_v025_clear_test_data.sql
 *   node backend/scripts/run-migration.js rollback 015_rollback.sql
 *   node backend/scripts/run-migration.js verify markers space_id has_worldmap anchor_kind
 *
 * Splits .sql file on `;` boundaries (naive but sufficient for our hand-written
 * Constitution-compliant migrations — no triggers, no procedures).
 *
 * Verifies columns exist after apply via INFORMATION_SCHEMA (schema diff).
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'migrations');

function dbConfig() {
    const dbName = process.env.DB_NAME;
    if (!dbName) throw new Error('DB_NAME missing in env');
    return {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: dbName,
        multipleStatements: true,
        connectTimeout: 15000,
    };
}

const ALLOWED_DB_NAMES = ['cairn', 'cairn_dev', 'cairn_test', 'cairn_staging'];

function assertSafeDb() {
    const dbName = process.env.DB_NAME;
    if (!ALLOWED_DB_NAMES.includes(dbName)) {
        throw new Error(`refusing to run migration against DB_NAME='${dbName}' — allowlist: ${ALLOWED_DB_NAMES.join(', ')}`);
    }
}

async function withConn(fn) {
    const c = await mysql.createConnection(dbConfig());
    try {
        return await fn(c);
    } finally {
        await c.end();
    }
}

function splitSql(text) {
    // RETAINED for reference but unused — see cmdApply: we now send the file in
    // one query() with multipleStatements: true to let mysql parse natively.
    const stripped = text
        .split('\n')
        .filter(l => !l.trim().startsWith('--'))
        .join('\n');
    return stripped
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

async function cmdApply(file) {
    assertSafeDb();
    const fp = path.isAbsolute(file) ? file : path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(fp)) throw new Error(`migration file not found: ${fp}`);
    const text = fs.readFileSync(fp, 'utf-8');
    console.log(`apply ${path.basename(fp)} (${text.length} bytes, multi-statement send)`);
    await withConn(async (c) => {
        // multipleStatements: true is set in dbConfig() — let mysql parse the
        // file natively. This is safer than splitting on `;` (string literals,
        // COMMENT clauses with semicolons, etc. would break naive splits).
        await c.query(text);
    });
    console.log(`apply OK`);
}

async function cmdRollback(file) {
    return cmdApply(file);
}

async function cmdVerify(table, ...columns) {
    if (!table) throw new Error('verify requires <table> <col1> [col2 ...]');
    await withConn(async (c) => {
        const [rows] = await c.execute(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, table]
        );
        const present = new Set(rows.map(r => r.COLUMN_NAME));
        const missing = columns.filter(col => !present.has(col));
        const found = columns.filter(col => present.has(col));
        console.log(`verify ${table}: present columns ${found.length}/${columns.length}`);
        for (const col of columns) {
            if (present.has(col)) {
                const r = rows.find(rr => rr.COLUMN_NAME === col);
                console.log(`  [OK] ${col} ${r.COLUMN_TYPE} ${r.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'} default=${r.COLUMN_DEFAULT}`);
            } else {
                console.log(`  [MISS] ${col}`);
            }
        }
        if (missing.length) {
            console.error(`verify FAIL: missing ${missing.join(', ')}`);
            process.exit(1);
        }
        console.log(`verify PASS`);
    });
}

async function cmdSchemaDump(table) {
    await withConn(async (c) => {
        const [rows] = await c.query(`SHOW CREATE TABLE \`${table}\``);
        console.log(rows[0]['Create Table']);
    });
}

async function main() {
    const [, , cmd, ...rest] = process.argv;
    try {
        if (cmd === 'apply') await cmdApply(rest[0]);
        else if (cmd === 'rollback') await cmdRollback(rest[0]);
        else if (cmd === 'verify') await cmdVerify(rest[0], ...rest.slice(1));
        else if (cmd === 'schema') await cmdSchemaDump(rest[0]);
        else {
            console.log('usage: run-migration.js {apply|rollback|verify|schema} <args>');
            process.exit(2);
        }
    } catch (e) {
        console.error(`ERR: ${e.message}`);
        process.exit(1);
    }
}

main();
