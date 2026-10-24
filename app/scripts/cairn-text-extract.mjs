#!/usr/bin/env node

/**
 * One-time/source-incremental extractor for strongly identifiable app UI copy.
 * It uses Babel AST locations but applies byte-range replacements so unrelated
 * formatting and comments are preserved. Run without --apply for a read-only
 * inventory; --apply migrates only newly discovered callsites and appends
 * annotated, owner-editable entries to src/i18n/cairnText.ts.
 */
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
const exceptionsPath = path.join(sourceRoot, 'i18n', 'cairnTextExceptions.json');
const reviewedExceptions = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');
const reportArg = process.argv.find(argument => argument.startsWith('--report='));
const reportPath = reportArg ? path.resolve(reportArg.slice('--report='.length)) : null;

const attributeNames = new Set([
  'accessibilityLabel', 'accessibilityHint', 'placeholder', 'title', 'message',
  'label', 'headerTitle', 'headerBackTitle', 'prompt', 'cancelButtonTitle',
  'body', 'actionLabel', 'emptyText', 'loadingText', 'errorText', 'description',
  'subtitle', 'caption', 'helperText', 'confirmLabel', 'cancelLabel', 'detail', 'value',
  'primaryLabel', 'secondaryLabel', 'inputLabel', 'sheetTitle', 'meta', 'eyebrow',
  'error', 'status',
]);
const displayPropertyNames = new Set([
  'accessibilityLabel', 'accessibilityHint', 'placeholder', 'title', 'message',
  'label', 'headerTitle', 'headerBackTitle', 'prompt', 'cancelButtonTitle',
  'body', 'actionLabel', 'emptyText', 'loadingText', 'errorText', 'description',
  'subtitle', 'caption', 'helperText', 'confirmLabel', 'cancelLabel',
  'primaryLabel', 'secondaryLabel', 'inputLabel', 'sheetTitle', 'text',
  'error', 'lastError', 'warning', 'notice', 'details',
]);
const naturalDisplayPropertyNames = new Set([
  'successTitle', 'explanation', 'explainer', 'action', 'summary', 'eyebrow',
  'dialogTitle', 'savingHikeStep', 'notificationTitle', 'notificationBody',
  'leaveTitle', 'notePrompt', 'encounterTitle', 'shortLabel', 'meta',
  'lastWarning', 'routeLabel', 'routeDetail', 'primaryText', 'scenario',
  'transportFixture', 'oracleRequirements', 'lastFailure',
]);
const commonKeys = new Map([
  ['Back', 'navigation.back'], ['Cancel', 'common.cancel'], ['Close', 'common.close'],
  ['Continue', 'common.continue'], ['Done', 'common.done'], ['Loading…', 'common.loading'],
  ['Loading...', 'common.loading'], ['Retry', 'common.retry'], ['Save', 'common.save'],
  ['Search', 'common.search'],
]);

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || absolute === path.join(sourceRoot, 'i18n')) continue;
      walk(absolute, output);
    } else if (/\.(ts|tsx)$/.test(entry.name)
      && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
      && !entry.name.endsWith('.d.ts')) output.push(absolute);
  }
  return output;
}

const files = [path.join(appRoot, 'App.tsx'), path.join(appRoot, 'MigratorRetryPrompt.tsx'), ...walk(sourceRoot)]
  .filter(file => fs.existsSync(file));

function parse(source, filename) {
  return parser.parse(source, {
    sourceType: 'module',
    sourceFilename: filename,
    plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy', 'optionalChaining', 'nullishCoalescingOperator'],
  });
}

function visibleText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function isDisplayText(value) {
  const normalized = visibleText(value);
  return normalized.length > 0 && /\p{L}/u.test(normalized);
}

function looksLikeNaturalCopy(value) {
  const normalized = visibleText(value);
  return /\s/.test(normalized) || /[…,.!?。！？]/.test(normalized)
    || /^[A-Z][a-z]+$/.test(normalized) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
}

function looksLikeUserCopy(value) {
  const normalized = visibleText(value);
  return /^[A-Z]/.test(normalized) || /[.!?…。！？]/.test(normalized) || /\b[A-Z]{2,}\b/.test(normalized)
    || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);
}

function assignmentName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node?.type === 'ArrayPattern' && node.elements[0]?.type === 'Identifier') return node.elements[0].name;
  return '';
}

function technicalException(relativePath, kind, text) {
  const reasonCodeModules = new Set([
    'src/features/activity/activityDiagnosticReplay.ts',
    'src/features/activity/activityLocationHealth.ts',
    'src/features/activitySimulator/snapLabLogicalRunner.ts',
    'src/features/route/routeEditTransactions.ts',
    'src/features/route/routePlanningProvider.ts',
    'src/services/routing/pedestrianFinalRoute.ts',
    'src/services/routing/snapTrack.ts',
    'src/store/useTrackingStore.ts',
  ]);
  if (reasonCodeModules.has(relativePath)
    && /^display-(variable|assignment):.*(reason|status)$/i.test(kind)) {
    return 'Stable decision/status reason byte used by geometry, replay or ownership logic; user-facing surfaces map it to catalog copy separately.';
  }
  if (relativePath === 'src/features/memory/screens/MemoryScreen.tsx'
    && /^display-variable:reason$/i.test(kind)
    && /^(timeout|error)$/.test(text)) {
    return 'Typed one-shot location failure discriminator; Memory presentation maps this state to catalog copy separately.';
  }
  if (relativePath === 'src/components/StateSurface.tsx' && kind === 'property:error') {
    return 'Typed icon registry identifier, not display copy.';
  }
  if ((relativePath === 'src/features/cairns/cairnPresentationStore.ts'
      || relativePath === 'src/features/public/services/publicCairns.ts'
      || relativePath === 'src/services/accountTransitionAuthority.ts')
    && kind === 'property:error') {
    return 'Stable domain/error discriminator used for behaviour; UI maps it to catalog copy separately.';
  }
  if (relativePath === 'src/features/routeDrawing/routeDrawingTrace.ts'
    && kind.includes('captureError')) {
    return 'Stable bounded-trace completeness code, not normal UI copy.';
  }
  if (relativePath === 'src/features/cairns/cairnPresentationStore.ts'
    && kind.endsWith(':nextError')) {
    return 'Stable presentation failure category; its normal UI message is resolved from the catalog separately.';
  }
  if (relativePath === 'src/features/public/services/publicCairns.ts'
    && kind.endsWith(':publicError')) {
    return 'Stable Public Cairn failure category; its normal UI message is resolved from the catalog separately.';
  }
  if (relativePath === 'src/components/home/SunnyMotionLayer.tsx' && kind.startsWith('display-assignment:')) {
    return 'Developer animation-channel diagnostic payload; technical reason tokens remain byte-stable.';
  }
  if (relativePath === 'src/services/LegacyRouteMigrator.ts' && kind === 'property:error') {
    return 'Internal migration diagnostic detail; the surrounding user explanation is catalogued separately.';
  }
  if (relativePath === 'src/features/route/routePlanningProvider.ts' && kind === 'property:detail') {
    return 'Routing operation-stage identifier, not user copy.';
  }
  if (relativePath.includes('/services/routing/mapmatch/') && kind === 'property:detail') {
    return 'Map-matching diagnostic detail retained for technical replay; normal UI maps its stable outcome separately.';
  }
  if (relativePath === 'src/services/authService.ts' && kind === 'property:hint') {
    return 'Stable account-reconciliation hint code used for behaviour, never normal display copy.';
  }
  if (relativePath === 'src/services/authService.ts' && kind === 'property:error'
    && /^[a-z][a-z0-9_-]*$/.test(text)) {
    return 'Stable authentication/authority result code used for behaviour; the UI maps user-visible failures to catalog copy.';
  }
  if (relativePath === 'src/services/authService.ts' && kind === 'property:error'
    && (/^HTTP \{status\}$/.test(text) || /^http_\{status\}$/.test(text))) {
    return 'Stable authentication transport/status result code; normal UI owns separately catalogued copy.';
  }
  if (relativePath === 'src/services/trackingTokenRefreshAuthority.ts' && kind === 'property:error') {
    return 'Stable tracking-authority result code used for ownership checks and tests, not normal UI copy.';
  }
  if (relativePath === 'src/services/offlineQueue.ts'
    && (kind === 'display-assignment:lastError' || kind === 'display-variable:lastError')) {
    return 'Bounded offline-operation diagnostic payload; reachable diagnostic UI localizes its labels but preserves these bytes.';
  }
  if (relativePath === 'src/components/OtaBadge.tsx' && kind === 'display-variable:TIMEOUT_ERROR') {
    return 'Stable OTA timeout discriminator used to classify an operation result; user-visible error copy is catalogued separately.';
  }
  if (relativePath === 'src/store/useRouteEditStore.ts' && kind === 'property:error') {
    return 'Internal edit transaction result code/detail; the adjacent lastError field owns localized display copy.';
  }
  if ((relativePath === 'src/services/routing/pedestrianFinalRoute.ts'
      || relativePath === 'src/services/routing/snapTrack.ts')
    && kind.startsWith('display-variable:text')) {
    return 'Provider coordinate request payload; deliberately excluded from translation and automatic evidence.';
  }
  if (/^[a-z0-9_-]+$/.test(text) && (kind === 'property:detail' || kind === 'property:hint')) {
    return 'Lowercase protocol/status identifier, not app display copy.';
  }
  return null;
}

function propertyName(node) {
  if (!node || node.computed) return null;
  if (node.key?.type === 'Identifier') return node.key.name;
  if (node.key?.type === 'StringLiteral') return node.key.value;
  return null;
}

function calleeName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const owner = calleeName(node.object);
    return owner ? `${owner}.${node.property.name}` : node.property.name;
  }
  return '';
}

function surfaceFor(file) {
  const relative = path.relative(sourceRoot, file).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, '');
  return relative.startsWith('../') ? path.basename(file).replace(/\.(ts|tsx)$/, '') : relative;
}

function namespaceFor(file) {
  const surface = surfaceFor(file)
    .replace(/\/index$/, '')
    .replace(/(^|\/)(components?|screens?|services?|store|hooks?|utils?|features?)\//g, '$1')
    .replace(/[^A-Za-z0-9/]+/g, '-')
    .split('/').filter(Boolean).slice(-2).join('.');
  return surface.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() || 'app';
}

function slug(value) {
  const result = value
    .replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, ' value ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().toLowerCase().split(/\s+/).slice(0, 7).join('-');
  return result || 'copy';
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 7);
}

function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

function templateDetails(node, source) {
  const used = new Set();
  const params = [];
  const parts = [];
  node.quasis.forEach((quasi, index) => {
    parts.push(quasi.value.cooked ?? quasi.value.raw);
    const expression = node.expressions[index];
    if (!expression) return;
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
    const expressionSource = source.slice(expression.start, expression.end);
    const parameterType = /count|total|number|distance|duration|elevation|index|percent|progress/i.test(name)
      && !/\.to(Fixed|LocaleString)\(/.test(expressionSource) ? 'number' : 'string';
    params.push({ name, expression: expressionSource, type: parameterType });
    parts.push(`{${name}}`);
  });
  return { text: visibleText(parts.join('')), params };
}

function staticDetails(node) {
  const value = node.type === 'JSXText' ? node.value : node.value;
  return { text: visibleText(value), params: [] };
}

function nodeDetails(node, source) {
  if (node?.type === 'StringLiteral' || node?.type === 'JSXText') return staticDetails(node);
  if (node?.type === 'TemplateLiteral') return templateDetails(node, source);
  return null;
}

function isLiteralNode(node) {
  return node?.type === 'StringLiteral' || node?.type === 'TemplateLiteral';
}

function renderableBranches(node, add) {
  if (!node) return;
  if (isLiteralNode(node)) return add(node, 'jsx-expression');
  if (node.type === 'ConditionalExpression') {
    renderableBranches(node.consequent, add);
    renderableBranches(node.alternate, add);
  } else if (node.type === 'LogicalExpression') {
    renderableBranches(node.right, add);
  } else if (node.type === 'ArrayExpression') {
    node.elements.forEach(element => renderableBranches(element, add));
  }
}

const localizedReturnFunctions = new Set([
  'formatRelative', 'activityStartErrorMessage', 'phaseLabel', 'statusText',
  'publicCreationBlockReason', 'formatAge', 'packTitle', 'formatOfflineMapBytes',
  'cairnDisplayTitle', 'activityDateLabel', 'routeSourceLabel', 'routeStatusLabel',
  'routeModeLabel', 'validateEmail', 'validatePassword', 'validateDob',
  'formatRelativeDay', 'providerReason', 'editFailure', 'providerSummary',
  'turnWord', 'formatDate', 'getRelativeTime', 'passwordPolicyError',
  'formatSolarTime',
]);

function enclosingFunctionName(pathRef) {
  let cursor = pathRef;
  while (cursor) {
    if (cursor.isFunctionDeclaration?.()) return cursor.node.id?.name ?? '';
    if (cursor.isObjectMethod?.() || cursor.isClassMethod?.()) {
      return cursor.node.key?.type === 'Identifier' ? cursor.node.key.name : '';
    }
    if (cursor.isVariableDeclarator?.()) {
      return cursor.node.id?.type === 'Identifier' ? cursor.node.id.name : '';
    }
    cursor = cursor.parentPath;
  }
  return '';
}

const catalogSource = fs.readFileSync(catalogPath, 'utf8');
const catalogAst = parse(catalogSource, catalogPath);
const existingByText = new Map(commonKeys);
const existingKeys = new Set();
traverse(catalogAst, {
  ObjectProperty(pathRef) {
    const node = pathRef.node;
    if (pathRef.parentPath?.parentPath?.node !== catalogAst.program.body.find(item => item.type === 'ExportNamedDeclaration')?.declaration?.declarations?.[0]?.init) return;
    const key = node.key.type === 'StringLiteral' ? node.key.value : null;
    if (key) existingKeys.add(key);
  },
});
// Regex is intentionally limited to the stable top-level key syntax emitted
// below; Babel traversal above remains the structural validity check.
for (const match of catalogSource.matchAll(/^  '([^']+)': \{/gm)) existingKeys.add(match[1]);

const allCandidates = [];
const excludedCandidates = [];
const perFile = new Map();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = parse(source, file); } catch (error) {
    throw new Error(`Could not parse ${file}: ${error.message}`);
  }
  const candidates = [];
  const seenRanges = new Set();
  const add = (node, kind) => {
    const details = nodeDetails(node, source);
    if (!details || !isDisplayText(details.text)) return;
    const relativePath = path.relative(appRoot, file).replace(/\\/g, '/');
    const exception = reviewedExceptions.find(item => item.path === relativePath
      && item.syntax === kind && item.text === details.text);
    const builtInReason = technicalException(relativePath, kind, details.text);
    if (exception || builtInReason) {
      excludedCandidates.push({
        path: relativePath,
        line: node.loc?.start.line ?? 0,
        surface: surfaceFor(file),
        previousText: details.text,
        catalogKey: null,
        parameters: Object.fromEntries(details.params.map(parameter => [parameter.name, parameter.type])),
        classification: exception?.classification ?? 'TECHNICAL_PAYLOAD',
        exceptionReason: exception?.reason ?? builtInReason,
        syntax: kind,
      });
      return;
    }
    const range = `${node.start}:${node.end}`;
    if (seenRanges.has(range)) return;
    seenRanges.add(range);
    candidates.push({ file, source, node, kind, ...details });
  };
  traverse(ast, {
    JSXText(pathRef) {
      const siblings = pathRef.parentPath.node.children?.filter(child => child.type !== 'JSXText' || visibleText(child.value));
      if (siblings?.length === 1) add(pathRef.node, 'jsx-text');
    },
    JSXExpressionContainer(pathRef) {
      if (pathRef.parent.type === 'JSXAttribute') return;
      renderableBranches(pathRef.node.expression, add);
    },
    JSXAttribute(pathRef) {
      const name = pathRef.node.name?.name;
      if (!attributeNames.has(name) && !/(Label|Title|Description|Text|Message|Placeholder|Hint|Copy|Warning|Meta|Eyebrow)$/i.test(String(name))) return;
      const value = pathRef.node.value;
      if (value?.type === 'StringLiteral') add(value, `attribute-direct:${name}`);
      else if (value?.type === 'JSXExpressionContainer' && isLiteralNode(value.expression)) add(value.expression, `attribute:${name}`);
      else if (value?.type === 'JSXExpressionContainer') renderableBranches(value.expression, node => add(node, `attribute:${name}`));
    },
    ObjectProperty(pathRef) {
      const name = propertyName(pathRef.node);
      const namedNaturalCopy = naturalDisplayPropertyNames.has(name)
        && isLiteralNode(pathRef.node.value)
        && looksLikeUserCopy(nodeDetails(pathRef.node.value, source)?.text ?? '');
      if (!displayPropertyNames.has(name) && !['detail', 'hint'].includes(name)
        && !namedNaturalCopy) return;
      if (isLiteralNode(pathRef.node.value)) add(pathRef.node.value, `property:${name}`);
      else renderableBranches(pathRef.node.value, node => add(node, `property:${name}`));
    },
    CallExpression(pathRef) {
      const name = calleeName(pathRef.node.callee);
      const actionName = name.split('.').at(-1) ?? name;
      if (name === 'Alert.alert') {
        pathRef.node.arguments.slice(0, 2).forEach(argument => {
          if (isLiteralNode(argument)) add(argument, 'alert');
          else renderableBranches(argument, node => add(node, 'alert'));
        });
        const buttons = pathRef.node.arguments[2];
        if (buttons?.type === 'ArrayExpression') {
          buttons.elements.forEach(element => {
            if (element?.type !== 'ObjectExpression') return;
            element.properties.forEach(property => {
              if (property.type === 'ObjectProperty' && propertyName(property) === 'text' && isLiteralNode(property.value)) add(property.value, 'alert-action');
            });
          });
        }
      } else if (name === 'renderHeader') {
        const argument = pathRef.node.arguments[0];
        if (isLiteralNode(argument)) add(argument, 'display-helper:renderHeader');
        else renderableBranches(argument, node => add(node, 'display-helper:renderHeader'));
      } else if (/^(show|set).*(Toast|Snackbar|Banner|Error|Err|Failure|Notice|Warning|Message|Feedback)$/i.test(actionName)) {
        const argumentsToInspect = /^show.*Feedback$/i.test(actionName)
          ? pathRef.node.arguments.slice(0, 2)
          : pathRef.node.arguments.slice(0, 1);
        argumentsToInspect.forEach(argument => {
          if (isLiteralNode(argument)) add(argument, `message-call:${name}`);
          else renderableBranches(argument, node => add(node, `message-call:${name}`));
        });
      } else if (name === 'push' && pathRef.node.callee.type === 'MemberExpression'
        && pathRef.node.callee.object.type === 'Identifier'
        && /(notes?|messages?|warnings?|details?|reasons?)/i.test(pathRef.node.callee.object.name)) {
        const argument = pathRef.node.arguments[0];
        if (isLiteralNode(argument)) add(argument, `display-array:${pathRef.node.callee.object.name}`);
      }
    },
    VariableDeclarator(pathRef) {
      const name = assignmentName(pathRef.node.id);
      if (!/(labels?|copy|message|description|details?|body|reason|truth|block|meta|eyebrow|noun|verb|unit|title|subtitle|heading|name|hint|placeholder|error|notice|warning|text)$/i.test(name)) return;
      const initial = pathRef.node.init;
      if (isLiteralNode(initial) && looksLikeNaturalCopy(nodeDetails(initial, source)?.text ?? '')) {
        add(initial, `display-variable:${name}`);
      } else if (initial?.type === 'CallExpression' && calleeName(initial.callee) === 'useState') {
        const argument = initial.arguments[0];
        if (isLiteralNode(argument) && looksLikeNaturalCopy(nodeDetails(argument, source)?.text ?? '')) add(argument, `display-state:${name}`);
      } else if (initial?.type === 'ObjectExpression' && /labels$/i.test(name)) {
        initial.properties.forEach(property => {
          if (property.type === 'ObjectProperty' && isLiteralNode(property.value)) add(property.value, `display-variable:${name}`);
        });
      } else renderableBranches(initial, node => add(node, `display-variable:${name}`));
    },
    AssignmentExpression(pathRef) {
      const name = assignmentName(pathRef.node.left);
      if (!/(label|copy|message|description|detail|body|reason|truth|block|meta|eyebrow|noun|verb|unit|title|subtitle|heading|name|hint|placeholder|error|notice|warning|text)$/i.test(name)) return;
      const right = pathRef.node.right;
      if (isLiteralNode(right) && looksLikeNaturalCopy(nodeDetails(right, source)?.text ?? '')) add(right, `display-assignment:${name}`);
      else renderableBranches(right, node => add(node, `display-assignment:${name}`));
    },
    ReturnStatement(pathRef) {
      const functionName = enclosingFunctionName(pathRef);
      if (!localizedReturnFunctions.has(functionName)) return;
      const argument = pathRef.node.argument;
      if (isLiteralNode(argument)) add(argument, `return:${functionName}`);
      else renderableBranches(argument, node => add(node, `return:${functionName}`));
    },
  });
  if (candidates.length) perFile.set(file, { source, candidates });
  allCandidates.push(...candidates);
}

const assignedBySignature = new Map();
const newEntries = new Map();
for (const candidate of allCandidates) {
  const signature = `${namespaceFor(candidate.file)}\0${candidate.text}\0${candidate.params.map(parameter => parameter.name).join(',')}`;
  let key = commonKeys.get(candidate.text) ?? assignedBySignature.get(signature);
  if (!key) {
    const base = `${namespaceFor(candidate.file)}.${slug(candidate.text)}`;
    key = base;
    if (existingKeys.has(key) || [...newEntries.values()].some(entry => entry.key === key && entry.text !== candidate.text)) {
      key = `${base}-${hash(signature)}`;
    }
    assignedBySignature.set(signature, key);
  }
  candidate.key = key;
  if (!existingKeys.has(key) && !newEntries.has(key)) {
    newEntries.set(key, {
      key,
      text: candidate.text,
      params: candidate.params,
      surface: surfaceFor(candidate.file),
      line: candidate.node.loc?.start.line ?? 0,
      kind: candidate.kind,
    });
  }
}

const inventory = allCandidates.map(candidate => ({
  path: path.relative(appRoot, candidate.file).replace(/\\/g, '/'),
  line: candidate.node.loc?.start.line ?? 0,
  surface: surfaceFor(candidate.file),
  previousText: candidate.text,
  catalogKey: candidate.key,
  parameters: Object.fromEntries(candidate.params.map(parameter => [parameter.name, parameter.type])),
  classification: 'APP_OWNED_MIGRATED',
  syntax: candidate.kind,
})).concat(excludedCandidates);

if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), candidates: inventory }, null, 2)}\n`);
}

if (!apply) {
  console.log(JSON.stringify({ files: perFile.size, callsites: allCandidates.length, newEntries: newEntries.size, reportPath }, null, 2));
  process.exit(check && allCandidates.length > 0 ? 1 : 0);
}

const rewrittenFiles = new Map();
for (const [file, record] of perFile) {
  let source = record.source;
  const replacements = record.candidates.map(candidate => {
    const params = candidate.params.length
      ? `, { ${candidate.params.map(parameter => `${parameter.name}: ${parameter.expression}`).join(', ')} }`
      : '';
    const call = `cairnText('${candidate.key}'${params})`;
    return {
      start: candidate.node.start,
      end: candidate.node.end,
      value: candidate.node.type === 'JSXText' || candidate.kind.startsWith('attribute-direct:')
        ? `{${call}}`
        : call,
    };
  }).sort((left, right) => right.start - left.start);
  for (const replacement of replacements) {
    source = `${source.slice(0, replacement.start)}${replacement.value}${source.slice(replacement.end)}`;
  }
  if (!/from ['"][^'"]*i18n\/runtime['"]/.test(source)) {
    let ast;
    try {
      ast = parse(source, file);
    } catch (error) {
      const line = Number(error?.loc?.line ?? 1);
      const excerpt = source.split(/\r?\n/).slice(Math.max(0, line - 3), line + 2).join('\n');
      throw new Error(`Migration generated invalid syntax in ${path.relative(appRoot, file)}:${line}\n${excerpt}\n${error.message}`);
    }
    const imports = ast.program.body.filter(node => node.type === 'ImportDeclaration');
    const insertion = imports.length ? imports.at(-1).end : 0;
    const relativeRuntime = path.relative(path.dirname(file), path.join(sourceRoot, 'i18n', 'runtime')).replace(/\\/g, '/');
    const specifier = relativeRuntime.startsWith('.') ? relativeRuntime : `./${relativeRuntime}`;
    source = `${source.slice(0, insertion)}\nimport { cairnText } from '${specifier}';${source.slice(insertion)}`;
  }
  try {
    parse(source, file);
  } catch (error) {
    const line = Number(error?.loc?.line ?? 1);
    const excerpt = source.split(/\r?\n/).slice(Math.max(0, line - 3), line + 2).join('\n');
    throw new Error(`Migration generated invalid syntax in ${path.relative(appRoot, file)}:${line}\n${excerpt}\n${error.message}`);
  }
  rewrittenFiles.set(file, source);
}

for (const [file, source] of rewrittenFiles) fs.writeFileSync(file, source);

if (newEntries.size) {
  const marker = '  // CAIRN_TEXT_EXTRACTED_ENTRIES — owner-editable entries are appended here.';
  const generated = [...newEntries.values()].sort((left, right) => left.key.localeCompare(right.key)).map(entry => {
    const params = entry.params.length
      ? `{ ${entry.params.map(parameter => `${parameter.name}: '${parameter.type}'`).join(', ')} }`
      : '{}';
    const layout = entry.kind.startsWith('attribute:accessibility')
      ? 'Accessibility copy; must remain meaningful without visual context.'
      : entry.text.length <= 24
        ? 'Compact UI copy; allow normal font scaling and wrapping where needed.'
        : 'Body/status copy; allow wrapping and large accessibility text.';
    return [
      `  ${quote(entry.key)}: {`,
      `    'en-NZ': ${quote(entry.text)},`,
      "    'ja-JP': null,",
      `    context: ${quote(`App-owned copy extracted from ${entry.surface}:${entry.line} (${entry.kind}). Preserve the stated UI meaning; do not translate user data or protocol values.`)},`,
      `    surfaces: [${quote(entry.surface)}],`,
      `    params: ${params},`,
      `    layout: ${quote(layout)},`,
      "    translationStatus: { 'en-NZ': 'source', 'ja-JP': 'pending' },",
      '  },',
    ].join('\n');
  }).join('\n');
  const current = fs.readFileSync(catalogPath, 'utf8');
  if (!current.includes(marker)) throw new Error('Catalog insertion marker missing');
  fs.writeFileSync(catalogPath, current.replace(marker, `${generated}\n${marker}`));
}

console.log(JSON.stringify({ migratedFiles: perFile.size, callsites: allCandidates.length, appendedEntries: newEntries.size, reportPath }, null, 2));
