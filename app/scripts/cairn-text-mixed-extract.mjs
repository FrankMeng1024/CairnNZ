#!/usr/bin/env node

/** Extract whole mixed JSX sentences (static copy plus dynamic values). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceRoot = path.join(appRoot, 'src');
const catalogPath = path.join(sourceRoot, 'i18n', 'cairnText.ts');
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');
const reportArg = process.argv.find(argument => argument.startsWith('--report='));
const reportPath = reportArg ? path.resolve(reportArg.slice('--report='.length)) : null;

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || absolute === path.join(sourceRoot, 'i18n')) continue;
      walk(absolute, output);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

const files = [path.join(appRoot, 'App.tsx'), path.join(appRoot, 'MigratorRetryPrompt.tsx'), ...walk(sourceRoot)]
  .filter(file => fs.existsSync(file));
const parse = (source, filename) => parser.parse(source, {
  sourceType: 'module', sourceFilename: filename,
  plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy', 'optionalChaining', 'nullishCoalescingOperator'],
});
const quote = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 7);
const visible = value => value.replace(/\s+/g, ' ').trim();
const surfaceFor = file => path.relative(sourceRoot, file).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, '').replace(/^\.\.\//, '');
const namespaceFor = file => surfaceFor(file)
  .replace(/\/index$/, '').replace(/(^|\/)(components?|screens?|services?|store|hooks?|utils?|features?)\//g, '$1')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9/]+/g, '-').split('/').filter(Boolean).slice(-2).join('.').toLowerCase() || 'app';
const slug = value => value.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, ' value ')
  .replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase().split(/\s+/).slice(0, 7).join('-') || 'copy';
const existingKeys = new Set([...fs.readFileSync(catalogPath, 'utf8').matchAll(/^  '([^']+)': \{/gm)].map(match => match[1]));
const commonKeys = new Map([
  ['Back', 'navigation.back'], ['Cancel', 'common.cancel'], ['Close', 'common.close'],
  ['Continue', 'common.continue'], ['Done', 'common.done'], ['Loading…', 'common.loading'],
  ['Retry', 'common.retry'], ['Save', 'common.save'], ['Search', 'common.search'],
]);

function jsxTextValue(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let index = 0; index < lines.length; index += 1) if (/[^ \t]/.test(lines[index])) lastNonEmpty = index;
  let output = '';
  lines.forEach((line, index) => {
    let next = line.replace(/\t/g, ' ');
    if (index !== 0) next = next.replace(/^ +/, '');
    if (index !== lines.length - 1) next = next.replace(/ +$/, '');
    if (next && index !== lastNonEmpty) next += ' ';
    output += next;
  });
  return output;
}

function elementName(node) {
  if (node?.type !== 'JSXIdentifier') return '';
  return node.name;
}

function parameterName(expression, index, used) {
  let base = expression.type === 'Identifier'
    ? expression.name
    : expression.type === 'MemberExpression' && !expression.computed && expression.property.type === 'Identifier'
      ? expression.property.name
      : `value${index + 1}`;
  base = base.replace(/[^A-Za-z0-9_]/g, '') || `value${index + 1}`;
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base}${suffix++}`;
  used.add(name);
  return name;
}

function flattenChildren(children, source) {
  const params = [];
  const used = new Set();
  let template = '';
  const appendExpression = expression => {
    const name = parameterName(expression, params.length, used);
    const expressionSource = source.slice(expression.start, expression.end);
    const type = /count|total|number|distance|duration|elevation|index|percent|progress|radius|accuracy/i.test(name)
      && !/\.to(Fixed|LocaleString)\(/.test(expressionSource) ? 'number' : 'string';
    params.push({ name, expression: expressionSource, type });
    template += `{${name}}`;
  };
  const visit = child => {
    if (child.type === 'JSXText') {
      template += jsxTextValue(child.value);
      return true;
    }
    if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'JSXEmptyExpression') return true;
      if (child.expression.type === 'JSXElement' || child.expression.type === 'JSXFragment') return false;
      appendExpression(child.expression);
      return true;
    }
    if (child.type === 'JSXElement' && /Text$/.test(elementName(child.openingElement.name))) {
      return child.children.every(visit);
    }
    return false;
  };
  if (!children.every(visit)) return null;
  const text = visible(template);
  return /\p{L}/u.test(text) ? { text, params } : null;
}

const candidates = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parse(source, file);
  traverse(ast, {
    JSXElement(pathRef) {
      const node = pathRef.node;
      if (!/Text$/.test(elementName(node.openingElement.name))) return;
      const meaningful = node.children.filter(child => child.type !== 'JSXText' || visible(child.value));
      if (meaningful.length < 2) return;
      const details = flattenChildren(node.children, source);
      if (!details) return;
      const start = node.children[0]?.start;
      const end = node.children.at(-1)?.end;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return;
      candidates.push({ file, source, node, start, end, ...details });
      pathRef.skip();
    },
  });
}

const bySignature = new Map();
const newEntries = new Map();
for (const candidate of candidates) {
  const signature = `${namespaceFor(candidate.file)}\0${candidate.text}\0${candidate.params.map(param => param.name).join(',')}`;
  let key = commonKeys.get(candidate.text) ?? bySignature.get(signature);
  if (!key) {
    const base = `${namespaceFor(candidate.file)}.${slug(candidate.text)}`;
    key = existingKeys.has(base) ? `${base}-${hash(signature)}` : base;
    while (existingKeys.has(key) || newEntries.has(key)) key = `${base}-${hash(`${signature}:${key}`)}`;
    bySignature.set(signature, key);
  }
  candidate.key = key;
  if (!existingKeys.has(key) && !newEntries.has(key)) newEntries.set(key, {
    key, text: candidate.text, params: candidate.params,
    surface: surfaceFor(candidate.file), line: candidate.node.loc?.start.line ?? 0,
  });
}

const inventory = candidates.map(candidate => ({
  path: path.relative(appRoot, candidate.file).replace(/\\/g, '/'),
  line: candidate.node.loc?.start.line ?? 0,
  surface: surfaceFor(candidate.file), previousText: candidate.text,
  catalogKey: candidate.key,
  parameters: Object.fromEntries(candidate.params.map(param => [param.name, param.type])),
  classification: 'APP_OWNED_MIXED_SENTENCE_MIGRATED',
}));
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), candidates: inventory }, null, 2)}\n`);
}
if (!apply) {
  console.log(JSON.stringify({ files: new Set(candidates.map(candidate => candidate.file)).size, callsites: candidates.length, newEntries: newEntries.size, reportPath }, null, 2));
  process.exit(check && candidates.length > 0 ? 1 : 0);
}

const rewritten = new Map();
for (const file of new Set(candidates.map(candidate => candidate.file))) {
  let source = fs.readFileSync(file, 'utf8');
  const local = candidates.filter(candidate => candidate.file === file).sort((left, right) => right.start - left.start);
  for (const candidate of local) {
    const params = candidate.params.length
      ? `, { ${candidate.params.map(param => `${param.name}: ${param.expression}`).join(', ')} }`
      : '';
    const replacement = `{cairnText('${candidate.key}'${params})}`;
    source = `${source.slice(0, candidate.start)}${replacement}${source.slice(candidate.end)}`;
  }
  if (!/import \{[^}]*\bcairnText\b[^}]*\} from ['"][^'"]*i18n\/runtime['"]/.test(source)) {
    const ast = parse(source, file);
    const imports = ast.program.body.filter(node => node.type === 'ImportDeclaration');
    const insertion = imports.length ? imports.at(-1).end : 0;
    const relativeRuntime = path.relative(path.dirname(file), path.join(sourceRoot, 'i18n', 'runtime')).replace(/\\/g, '/');
    const specifier = relativeRuntime.startsWith('.') ? relativeRuntime : `./${relativeRuntime}`;
    source = `${source.slice(0, insertion)}\nimport { cairnText } from '${specifier}';${source.slice(insertion)}`;
  }
  try { parse(source, file); } catch (error) { throw new Error(`Invalid mixed-text migration in ${path.relative(appRoot, file)}: ${error.message}`); }
  rewritten.set(file, source);
}
for (const [file, source] of rewritten) fs.writeFileSync(file, source);

if (newEntries.size) {
  const marker = '  // CAIRN_TEXT_EXTRACTED_ENTRIES — owner-editable entries are appended here.';
  const entries = [...newEntries.values()].sort((left, right) => left.key.localeCompare(right.key)).map(entry => [
    `  ${quote(entry.key)}: {`,
    `    'en-NZ': ${quote(entry.text)},`,
    "    'ja-JP': null,",
    `    context: ${quote(`Whole app-owned sentence extracted from ${entry.surface}:${entry.line}. Named values may move in translation; preserve their meaning and units.`)},`,
    `    surfaces: [${quote(entry.surface)}],`,
    `    params: ${entry.params.length ? `{ ${entry.params.map(param => `${param.name}: '${param.type}'`).join(', ')} }` : '{}'},`,
    "    layout: 'Mixed dynamic copy; allow wrapping, large text and locale-specific value order.',",
    "    translationStatus: { 'en-NZ': 'source', 'ja-JP': 'pending' },",
    '  },',
  ].join('\n')).join('\n');
  const current = fs.readFileSync(catalogPath, 'utf8');
  fs.writeFileSync(catalogPath, current.replace(marker, `${entries}\n${marker}`));
}
console.log(JSON.stringify({ migratedFiles: rewritten.size, callsites: candidates.length, appendedEntries: newEntries.size, reportPath }, null, 2));
