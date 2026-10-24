#!/usr/bin/env node

/**
 * Keep catalog-backed module configuration locale-live. A call evaluated at
 * import time freezes the first locale; an object getter resolves at render or
 * use time without remounting stateful screens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceRoot = path.join(appRoot, 'src');
const apply = process.argv.includes('--apply');

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'i18n') continue;
      walk(absolute, output);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

const parse = (source, filename) => parser.parse(source, {
  sourceType: 'module', sourceFilename: filename,
  plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
});

const findings = [];
for (const file of walk(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  const replacements = [];
  traverse(parse(source, file), {
    CallExpression(pathRef) {
      if (pathRef.node.callee.type !== 'Identifier' || pathRef.node.callee.name !== 'cairnText') return;
      if (pathRef.getFunctionParent()) return;
      const parent = pathRef.parentPath;
      if (!parent?.isObjectProperty() || parent.node.value !== pathRef.node || parent.node.computed) {
        findings.push({ path: path.relative(appRoot, file).replace(/\\/g, '/'), line: pathRef.node.loc?.start.line ?? 0, classification: 'UNSAFE_MODULE_SCOPE_CATALOG_CALL' });
        return;
      }
      const key = parent.node.key.type === 'Identifier'
        ? parent.node.key.name
        : parent.node.key.type === 'StringLiteral' ? JSON.stringify(parent.node.key.value) : null;
      if (!key) {
        findings.push({ path: path.relative(appRoot, file).replace(/\\/g, '/'), line: pathRef.node.loc?.start.line ?? 0, classification: 'UNSUPPORTED_STATIC_PROPERTY' });
        return;
      }
      findings.push({ path: path.relative(appRoot, file).replace(/\\/g, '/'), line: pathRef.node.loc?.start.line ?? 0, classification: 'CONVERTIBLE_STATIC_PROPERTY', property: key });
      replacements.push({
        start: parent.node.start,
        end: parent.node.end,
        value: `get ${key}() { return ${source.slice(pathRef.node.start, pathRef.node.end)}; }`,
      });
    },
  });
  if (apply && replacements.length) {
    let next = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
      next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
    }
    parse(next, file);
    fs.writeFileSync(file, next);
  }
}

console.log(JSON.stringify({ apply, findings }, null, 2));
process.exit(!apply && findings.length ? 1 : 0);
