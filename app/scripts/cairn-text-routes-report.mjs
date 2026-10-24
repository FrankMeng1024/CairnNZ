#!/usr/bin/env node

/** Read-only inventory of registered navigation roots and text boundaries. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const navigatorPath = path.join(appRoot, 'src', 'navigation', 'RootNavigator.tsx');
const reportArg = process.argv.find(argument => argument.startsWith('--report='));
const reportPath = reportArg ? path.resolve(reportArg.slice('--report='.length)) : null;
const source = fs.readFileSync(navigatorPath, 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
const imports = new Map();
const routes = [];

traverse(ast, {
  ImportDeclaration(pathRef) {
    const modulePath = pathRef.node.source.value;
    for (const specifier of pathRef.node.specifiers) {
      if (specifier.local?.name) imports.set(specifier.local.name, modulePath);
    }
  },
  JSXOpeningElement(pathRef) {
    const element = pathRef.node.name;
    if (element.type !== 'JSXMemberExpression'
      || element.object.type !== 'JSXIdentifier' || element.object.name !== 'Stack'
      || element.property.type !== 'JSXIdentifier' || element.property.name !== 'Screen') return;
    const attributes = new Map(pathRef.node.attributes
      .filter(attribute => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier')
      .map(attribute => [attribute.name.name, attribute.value]));
    const nameNode = attributes.get('name');
    const componentNode = attributes.get('component');
    const routeName = nameNode?.type === 'StringLiteral' ? nameNode.value : null;
    const component = componentNode?.type === 'JSXExpressionContainer'
      && componentNode.expression.type === 'Identifier' ? componentNode.expression.name : null;
    if (!routeName) return;
    routes.push({
      routeName,
      component,
      sourceModule: component ? imports.get(component) ?? null : null,
      conditional: Boolean(pathRef.findParent(parent => parent.isLogicalExpression?.() || parent.isConditionalExpression?.())),
      line: pathRef.node.loc?.start.line ?? 0,
    });
  },
});

const exceptions = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'i18n', 'cairnTextExceptions.json'), 'utf8'));
const result = {
  generatedAt: new Date().toISOString(),
  navigator: 'src/navigation/RootNavigator.tsx',
  registeredRoots: routes,
  deepLinkConfiguration: /\blinking\s*=/.test(source) ? 'PRESENT_REVIEW_REQUIRED' : 'NO_EXPLICIT_LINKING_CONFIG_IN_ROOT_NAVIGATOR',
  reviewedNonCatalogBoundaries: exceptions,
  explicitExternalBoundaries: [
    'User-authored Cairn/Route text, names and emails',
    'Coordinates, record IDs, enum/protocol values and technical logs',
    'Mapbox attribution and third-party map/place labels',
    'System-owned permission buttons and external hosted legal pages',
  ],
};
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify({ registeredRoots: routes.length, reviewedExceptions: exceptions.length, reportPath }, null, 2));
