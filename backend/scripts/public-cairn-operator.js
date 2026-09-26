#!/usr/bin/env node
'use strict';

const apiBase = String(process.env.CAIRN_OPERATOR_API_URL || '').replace(/\/$/, '');
const token = String(process.env.CAIRN_OPERATOR_TOKEN || '');
const [command, ...args] = process.argv.slice(2);

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write([
    'Protected Public Cairn operator command',
    '',
    'Required environment:',
    '  CAIRN_OPERATOR_API_URL  Exact review API origin',
    '  CAIRN_OPERATOR_TOKEN    Short-lived token for a server-authorized operator',
    '',
    'Commands:',
    '  submissions [pending|published|rejected|suspended|withdrawn] [after_id]',
    '  decide <publication_id> <approve|reject|suspend|restore> <reason>',
    '  reports [pending|reviewed|dismissed|actioned] [after_id]',
    '  dispose <report_id> <reviewed|dismissed|actioned> <note>',
    '  audit [after_id]',
  ].join('\n') + '\n');
  process.exitCode = 2;
}

function positiveId(value, label) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) throw new Error(`${label} must be a positive integer`);
  return String(value);
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.json().catch(() => ({ error: 'Non-JSON response' }));
  if (!response.ok) {
    const error = new Error(`${response.status} ${body?.code || body?.error || 'request failed'}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function main() {
  if (!apiBase || !/^https?:\/\//.test(apiBase)) return usage('CAIRN_OPERATOR_API_URL is required.');
  if (!token) return usage('CAIRN_OPERATOR_TOKEN is required.');

  let result;
  if (command === 'submissions') {
    const state = args[0] || 'pending';
    if (!['pending', 'published', 'rejected', 'suspended', 'withdrawn'].includes(state)) {
      throw new Error('Invalid submission state');
    }
    const after = args[1] ? positiveId(args[1], 'after_id') : '0';
    result = await request(`/api/public-cairns/operator/submissions?state=${encodeURIComponent(state)}&after_id=${after}&limit=25`);
  } else if (command === 'decide') {
    const publicationId = positiveId(args[0], 'publication_id');
    const action = args[1];
    if (!['approve', 'reject', 'suspend', 'restore'].includes(action)) throw new Error('Invalid decision');
    const reason = args.slice(2).join(' ').trim().slice(0, 240);
    if (!reason) throw new Error('Decision reason is required');
    result = await request(`/api/public-cairns/operator/submissions/${publicationId}/decision`, {
      method: 'POST', body: JSON.stringify({ action, reason }),
    });
  } else if (command === 'reports') {
    const state = args[0] || 'pending';
    if (!['pending', 'reviewed', 'dismissed', 'actioned'].includes(state)) throw new Error('Invalid report state');
    const after = args[1] ? positiveId(args[1], 'after_id') : '0';
    result = await request(`/api/public-cairns/operator/reports?state=${encodeURIComponent(state)}&after_id=${after}&limit=25`);
  } else if (command === 'dispose') {
    const reportId = positiveId(args[0], 'report_id');
    const state = args[1];
    if (!['reviewed', 'dismissed', 'actioned'].includes(state)) throw new Error('Invalid disposition');
    const note = args.slice(2).join(' ').trim().slice(0, 240);
    if (!note) throw new Error('Disposition note is required');
    result = await request(`/api/public-cairns/operator/reports/${reportId}/disposition`, {
      method: 'POST', body: JSON.stringify({ state, note }),
    });
  } else if (command === 'audit') {
    const after = args[0] ? positiveId(args[0], 'after_id') : '0';
    result = await request(`/api/public-cairns/operator/audit?after_id=${after}&limit=50`);
  } else {
    return usage(command ? `Unknown command: ${command}` : 'A command is required.');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`Public operator command failed: ${error.message}\n`);
  if (error.body) process.stderr.write(`${JSON.stringify(error.body)}\n`);
  process.exitCode = 1;
});
