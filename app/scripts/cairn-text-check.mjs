#!/usr/bin/env node

/** Structural and callsite gate for CairnNZ's single editable text catalog. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceRoot = path.join(appRoot, 'src');
const catalogPath = path.join(sourceRoot, 'i18n', 'cairnText.ts');
const reportArg = process.argv.find(argument => argument.startsWith('--report='));
const reportPath = reportArg ? path.resolve(reportArg.slice('--report='.length)) : null;

const parse = (source, filename) => parser.parse(source, {
  sourceType: 'module', sourceFilename: filename,
  plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy', 'optionalChaining', 'nullishCoalescingOperator'],
});

function unwrap(node) {
  let current = node;
  while (current && ['TSSatisfiesExpression', 'TSAsExpression', 'TypeCastExpression'].includes(current.type)) current = current.expression;
  return current;
}

function propertyName(node) {
  if (!node || node.computed) return null;
  if (node.key?.type === 'StringLiteral') return node.key.value;
  if (node.key?.type === 'Identifier') return node.key.name;
  return null;
}

function objectProperties(node) {
  const value = unwrap(node);
  if (value?.type !== 'ObjectExpression') return new Map();
  return new Map(value.properties
    .filter(property => property.type === 'ObjectProperty')
    .map(property => [propertyName(property), property.value]));
}

function textVariants(node) {
  const value = unwrap(node);
  if (!value || value.type === 'NullLiteral') return null;
  if (value.type === 'StringLiteral') return [value.value];
  if (value.type !== 'ObjectExpression') return [];
  return value.properties
    .filter(property => property.type === 'ObjectProperty')
    .map(property => unwrap(property.value))
    .filter(candidate => candidate?.type === 'StringLiteral')
    .map(candidate => candidate.value);
}

function stringValue(node) {
  const value = unwrap(node);
  return value?.type === 'StringLiteral' ? value.value : null;
}

function placeholders(values) {
  const result = new Set();
  for (const value of values ?? []) {
    for (const match of value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) result.add(match[1]);
  }
  return [...result].sort();
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || absolute === path.join(sourceRoot, 'i18n')) continue;
      walk(absolute, output);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      output.push(absolute);
    }
  }
  return output;
}

const catalogSource = fs.readFileSync(catalogPath, 'utf8');
const catalogAst = parse(catalogSource, catalogPath);
let root = null;
traverse(catalogAst, {
  VariableDeclarator(pathRef) {
    if (pathRef.node.id.type === 'Identifier' && pathRef.node.id.name === 'CAIRN_TEXT') root = unwrap(pathRef.node.init);
  },
});
if (root?.type !== 'ObjectExpression') throw new Error('CAIRN_TEXT must be a declarative object literal');

const errors = [];
const entries = new Map();
for (const property of root.properties) {
  if (property.type !== 'ObjectProperty') continue;
  const key = propertyName(property);
  if (!key) continue;
  if (entries.has(key)) errors.push(`duplicate catalog key: ${key}`);
  const fields = objectProperties(property.value);
  const english = textVariants(fields.get('en-NZ'));
  const japanese = textVariants(fields.get('ja-JP'));
  const params = [...objectProperties(fields.get('params')).keys()].filter(Boolean).sort();
  const statuses = objectProperties(fields.get('translationStatus'));
  const enStatus = stringValue(statuses.get('en-NZ'));
  const jaStatus = stringValue(statuses.get('ja-JP'));
  if (!english?.length || english.some(value => !value.trim())) errors.push(`${key}: en-NZ is missing or blank`);
  if (!stringValue(fields.get('context'))?.trim()) errors.push(`${key}: context is missing`);
  if (!stringValue(fields.get('layout'))?.trim()) errors.push(`${key}: layout is missing`);
  if (unwrap(fields.get('surfaces'))?.type !== 'ArrayExpression') errors.push(`${key}: surfaces must be an array`);
  if (enStatus !== 'source') errors.push(`${key}: en-NZ translationStatus must be source`);
  if (japanese === null && jaStatus !== 'pending') errors.push(`${key}: null ja-JP must be explicitly pending`);
  if (japanese !== null && !['approved', 'draft'].includes(jaStatus)) errors.push(`${key}: populated ja-JP must be approved or draft`);
  const englishParams = placeholders(english);
  const japaneseParams = placeholders(japanese);
  if (JSON.stringify(params) !== JSON.stringify(englishParams)) errors.push(`${key}: params do not match en-NZ placeholders (${params} vs ${englishParams})`);
  if (japanese && JSON.stringify(englishParams) !== JSON.stringify(japaneseParams)) errors.push(`${key}: ja-JP placeholders differ from en-NZ`);
  entries.set(key, { english, japanese, params, jaStatus });
}

const files = [path.join(appRoot, 'App.tsx'), path.join(appRoot, 'MigratorRetryPrompt.tsx'), ...walk(sourceRoot)]
  .filter(file => fs.existsSync(file));
const callsites = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(appRoot, file).replace(/\\/g, '/');
  traverse(parse(source, file), {
    CallExpression(pathRef) {
      if (pathRef.node.callee.type !== 'Identifier' || pathRef.node.callee.name !== 'cairnText') return;
      const first = pathRef.node.arguments[0];
      if (first?.type !== 'StringLiteral') {
        errors.push(`${relative}:${pathRef.node.loc?.start.line ?? 0}: dynamic cairnText key is not reviewable`);
        return;
      }
      const key = first.value;
      const entry = entries.get(key);
      if (!entry) errors.push(`${relative}:${first.loc?.start.line ?? 0}: unknown catalog key ${key}`);
      const supplied = pathRef.node.arguments[1]?.type === 'ObjectExpression'
        ? pathRef.node.arguments[1].properties.filter(item => item.type === 'ObjectProperty').map(propertyName).filter(Boolean).sort()
        : [];
      if (entry && JSON.stringify(supplied) !== JSON.stringify(entry.params)) {
        errors.push(`${relative}:${first.loc?.start.line ?? 0}: ${key} params (${supplied}) differ from catalog (${entry.params})`);
      }
      const paramsPath = pathRef.get('arguments.1');
      if (paramsPath?.node) paramsPath.traverse({
        StringLiteral(stringPath) {
          if (stringPath.parentPath.isObjectProperty?.() && stringPath.parentPath.node.key === stringPath.node) return;
          let cursor = stringPath.parentPath;
          while (cursor && cursor !== paramsPath) {
            if (cursor.isCallExpression?.()
              && cursor.node.callee.type === 'Identifier'
              && cursor.node.callee.name === 'cairnText'
              && cursor.node.arguments[0] === stringPath.node) return;
            cursor = cursor.parentPath;
          }
          const value = stringPath.node.value.trim();
          const reviewedProtocol = /^[a-z0-9_:-]+$/.test(value)
            || /^[NSEW]$/.test(value)
            || /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(value);
          if (/\p{L}/u.test(value) && !reviewedProtocol) {
            errors.push(`${relative}:${stringPath.node.loc?.start.line ?? 0}: raw display fragment inside ${key} params: ${JSON.stringify(value)}`);
          }
        },
      });
      callsites.push({
        path: relative,
        line: first.loc?.start.line ?? 0,
        surface: relative.replace(/^src\//, '').replace(/\.(ts|tsx)$/, ''),
        previousText: entry?.english?.join(' | ') ?? null,
        catalogKey: key,
        parameters: Object.fromEntries((entry?.params ?? []).map(name => [name, 'catalog-declared'])),
        classification: 'APP_OWNED_CATALOG_CALLSITE',
        exceptionReason: null,
      });
    },
  });
}

const usedKeys = new Set(callsites.map(callsite => callsite.catalogKey));
// Runtime fallback and QA-only contract entries are deliberately not normal
// production callsites scanned above, but remain authoritative catalog rows.
[
  'common.search',
  'common.text-unavailable',
  'qa.sample.items',
  // Built-binary permission copy is verified separately against app.json by
  // cairn-native-text-check.mjs; these entries intentionally have no JS callsite.
  'native.permission.location-when-in-use',
  'native.permission.location-always',
  'native.permission.motion',
  'native.permission.feedback-photos',
  'native.permission.route-cairn-photos',
  'native.permission.camera',
].forEach(key => usedKeys.add(key));
const orphans = [...entries.keys()].filter(key => !usedKeys.has(key)).sort();
const summary = {
  catalogPath: path.relative(appRoot, catalogPath),
  entryCount: entries.size,
  callsiteCount: callsites.length,
  enNzComplete: [...entries.values()].filter(entry => entry.english?.length).length,
  jaJpApproved: [...entries.values()].filter(entry => entry.jaStatus === 'approved').length,
  jaJpDraft: [...entries.values()].filter(entry => entry.jaStatus === 'draft').length,
  jaJpPending: [...entries.values()].filter(entry => entry.jaStatus === 'pending').length,
  orphanCandidates: orphans,
  errors,
};
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, callsites }, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
process.exit(errors.length ? 1 : 0);
