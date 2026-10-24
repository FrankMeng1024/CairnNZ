import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CairnIcon, type CairnIconName } from '../components/CairnIcon';
import { cairnText } from '../i18n/runtime';

const ICONS: Array<{ name: CairnIconName; label: string }> = [
  { name: 'world', get label() { return cairnText('gate1-icon-sheet-screen.world-cairn'); } },
  { name: 'memory', get label() { return cairnText('gate1-icon-sheet-screen.memory'); } },
  { name: 'trails', get label() { return cairnText('gate1-icon-sheet-screen.trails'); } },
  { name: 'friends', get label() { return cairnText('gate1-icon-sheet-screen.shared-traces'); } },
  { name: 'leaveCairn', get label() { return cairnText('gate1-icon-sheet-screen.leave-cairn'); } },
  { name: 'hiking', get label() { return cairnText('gate1-icon-sheet-screen.hiking'); } },
  { name: 'running', get label() { return cairnText('gate1-icon-sheet-screen.running'); } },
  { name: 'layers', get label() { return cairnText('gate1-icon-sheet-screen.layers'); } },
  { name: 'compass', get label() { return cairnText('gate1-icon-sheet-screen.compass'); } },
  { name: 'personalTrace', get label() { return cairnText('gate1-icon-sheet-screen.personal-trace'); } },
  { name: 'otherTrace', get label() { return cairnText('gate1-icon-sheet-screen.other-trace'); } },
  { name: 'settings', get label() { return cairnText('gate1-icon-sheet-screen.settings'); } },
];

function StatePanel({ night = false }: { night?: boolean }) {
  const ink = night ? '#DDE6E7' : '#31594A';
  const active = night ? '#A7CFA9' : '#2F684F';
  const muted = night ? '#7F9296' : '#87958E';
  return (
    <View style={[s.panel, { backgroundColor: night ? '#182126' : '#F3F4EE', borderColor: night ? '#344147' : '#D8DED8' }]}>
      <Text style={[s.panelTitle, { color: night ? '#F0F4F2' : '#17372D' }]}>{night ? cairnText('gate1-icon-sheet-screen.night') : cairnText('gate1-icon-sheet-screen.day')}</Text>
      <Text style={[s.panelSub, { color: night ? '#9CACB0' : '#68766F' }]}>{cairnText('gate1-icon-sheet-screen.same-geometry-semantic-contrast')}</Text>
      <View style={s.grid}>
        {ICONS.map((item, index) => {
          const isActive = index === 0 || index === 3 || index === 4 || index === 8;
          return (
            <View key={item.name} style={s.iconCell}>
              <View style={[s.iconWell, isActive && { backgroundColor: night ? 'rgba(167,207,169,0.10)' : 'rgba(47,104,79,0.08)' }]}>
                <CairnIcon name={item.name} size={22} color={isActive ? ink : muted} accent={active} active={isActive} />
              </View>
              <Text style={[s.iconLabel, { color: night ? '#B7C3C3' : '#53635C' }]} numberOfLines={1}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Gate1IconSheetScreen() {
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>{cairnText('gate1-icon-sheet-screen.cairnnz-gate-2')}</Text>
      <Text style={s.title}>{cairnText('gate1-icon-sheet-screen.navigation-field-controls')}</Text>
      <Text style={s.intro}>{cairnText('gate1-icon-sheet-screen.mature-trail-pictograms-familiar-operational-silhouettes-precise')}</Text>
      <View style={s.panels}>
        <StatePanel />
        <StatePanel night />
      </View>
      <View style={s.scalePanel}>
        <View>
          <Text style={s.scaleTitle}>{cairnText('gate1-icon-sheet-screen.optical-scale')}</Text>
          <Text style={s.scaleSub}>{cairnText('gate1-icon-sheet-screen.optical-weight-is-tuned-at-real-size')}</Text>
        </View>
        <View style={s.scaleRow}>
          {[18, 20, 22, 24].map((size) => (
            <View key={size} style={s.scaleCell}>
              <CairnIcon name="memory" size={size} color="#31594A" accent="#2F684F" active />
              <Text style={s.scaleLabel}>{cairnText('gate1-icon-sheet-screen.value-px', { size: size })}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.ruleRow}>
        <Text style={s.rule}>{cairnText('gate1-icon-sheet-screen.active-adds-a-restrained-semantic-fill-or')}</Text>
        <Text style={s.rule}>{cairnText('gate1-icon-sheet-screen.day-night-keep-identical-geometry-and-change')}</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E9ECE6' },
  content: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 28, gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.7, color: '#5E7067' },
  title: { fontSize: 23, lineHeight: 27, fontWeight: '700', letterSpacing: -0.55, color: '#17372D' },
  intro: { maxWidth: 670, fontSize: 13, lineHeight: 19, color: '#5E6B65' },
  panels: { flexDirection: 'column', gap: 10 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 13 },
  panelTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  panelSub: { fontSize: 10, marginTop: 2, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  iconCell: { width: '25%', alignItems: 'center' },
  iconWell: { width: 38, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconLabel: { fontSize: 7.5, fontWeight: '600', marginTop: 3, maxWidth: 70, textAlign: 'center' },
  scalePanel: { borderRadius: 16, backgroundColor: '#F8F9F4', borderWidth: 1, borderColor: '#D8DED8', padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scaleTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: '#31594A' },
  scaleSub: { fontSize: 9, color: '#6A7770', marginTop: 2, maxWidth: 160 },
  scaleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  scaleCell: { alignItems: 'center', gap: 6, minWidth: 34 },
  scaleLabel: { fontSize: 9, fontWeight: '600', color: '#75817B' },
  ruleRow: { flexDirection: 'row', gap: 16 },
  rule: { flex: 1, fontSize: 9, lineHeight: 13, color: '#4F5E57', borderLeftWidth: 2, borderLeftColor: '#7AA184', paddingLeft: 8 },
});
