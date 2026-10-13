#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const appRoot=path.resolve(process.cwd());
const baseline=JSON.parse(fs.readFileSync(path.join(appRoot,'scripts/ui-legacy-baseline.json'),'utf8'));
const excludedPathParts=[
  '/__tests__/','/__mocks__/','/components/dev/','/features/marks/dev/',
  '/screens/auth_generated/','/screens/friends_generated/','/screens/hiking_generated/',
  '/screens/routes_generated/','/screens/running_generated/',
];
const excludedNamePatterns=[/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /PreviewScreen\.[tj]sx?$/, /\.OLD\./];
const centralThemeAuthorities=new Set(['src/components/tokens.ts','src/utils/homeBackground.ts','src/config/mapbox.ts']);
const colorPattern=/^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
const colorPropertyPattern=/(?:^|_)(?:color|backgroundColor|borderColor|shadowColor|textShadowColor|tintColor|overlayColor|fill|stroke)$/i;
const controls=new Set(['TouchableOpacity','TouchableWithoutFeedback','Pressable']);

function walk(dir,out=[]){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name); if(e.isDirectory())walk(p,out); else if(/\.[tj]sx?$/.test(e.name))out.push(p);
  } return out;
}
function rel(file){return path.relative(appRoot,file).split(path.sep).join('/');}
function excluded(file){const r=`/${rel(file)}`;return excludedPathParts.some(part=>r.includes(part))||excludedNamePatterns.some(re=>re.test(file));}
function nameText(name){return name&&(ts.isIdentifier(name)||ts.isStringLiteral(name)||ts.isNumericLiteral(name))?name.text:name?.getText?.()||'';}
function calleeName(expr){if(ts.isIdentifier(expr))return expr.text;if(ts.isPropertyAccessExpression(expr))return `${calleeName(expr.expression)}.${expr.name.text}`;return expr.getText();}
function jsxName(node){return node.getText();}
function attr(opening,name){return opening.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text===name);}
function attrText(a,sf){if(!a?.initializer)return '';if(ts.isStringLiteral(a.initializer))return a.initializer.text;if(ts.isJsxExpression(a.initializer))return a.initializer.expression?.getText(sf)||'';return a.initializer.getText(sf);}

const counts={alertCalls:0,rnModalUsages:0,localBackControls:0,hardcodedThemeViolationCandidates:0,mapOverlayHardcodedColorCandidates:0};
const localBackFiles=new Set();
const files=[...walk(path.join(appRoot,'src')),path.join(appRoot,'App.tsx')].filter(file=>!excluded(file));
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const relative=rel(file);
  function visit(node){
    if(ts.isCallExpression(node)&&calleeName(node.expression)==='Alert.alert') counts.alertCalls++;
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)){
      const opening=ts.isJsxElement(node)?node.openingElement:node;
      const tag=jsxName(opening.tagName);
      if(tag==='Modal') counts.rnModalUsages++;
      if(controls.has(tag)){
        const own=node.getText(sf).replace(/\s+/g,' ').slice(0,1400);
        const onPress=attrText(attr(opening,'onPress'),sf);
        if(/(?:\bBack\b|ArrowLeft|ChevronLeft|chevron-left|arrow-left)/.test(own)&&/goBack|navigate|dispatch/.test(onPress)){
          counts.localBackControls++;localBackFiles.add(relative);
        }
      }
    }
    if(ts.isStringLiteralLike(node)){
      const value=node.text.trim();
      if(colorPattern.test(value)){
        const parent=node.parent;let property='';
        if(ts.isPropertyAssignment(parent))property=nameText(parent.name);
        else if(ts.isJsxAttribute(parent))property=parent.name.text;
        const meaningful=colorPropertyPattern.test(property)||/color|background|border|shadow|fill|stroke/i.test(property);
        if(!centralThemeAuthorities.has(relative)&&meaningful){
          counts.hardcodedThemeViolationCandidates++;
          if(/Map|map|Fog|Route|route|Marker|marker|Cairn|cairn/.test(relative)||/lineColor|circleColor|fillColor|iconColor/.test(property)) counts.mapOverlayHardcodedColorCandidates++;
        }
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(sf);
}

const failures=[];
for(const [key,ceiling] of Object.entries(baseline.ceilings)) if(counts[key]>ceiling) failures.push(`${key} grew: ${counts[key]} > ${ceiling}`);
for(const file of localBackFiles) if(!baseline.allowedLocalBackFiles.includes(file)) failures.push(`unallowlisted local Back control: ${file}`);
console.log(JSON.stringify({baseline:baseline.ceilings,current:counts,localBackFiles:[...localBackFiles].sort()},null,2));
if(failures.length){console.error(`UI legacy guard — FAIL\n${failures.map(x=>`- ${x}`).join('\n')}`);process.exit(1);}
console.log('UI legacy guard — PASS');
