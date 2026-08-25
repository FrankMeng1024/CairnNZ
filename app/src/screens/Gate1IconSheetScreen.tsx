import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CairnIcon, type CairnIconName } from '../components/CairnIcon';

const ICONS: Array<{ name: CairnIconName; label: string }> = [
  { name: 'world', label: 'World / cairn' },
  { name: 'memory', label: 'Memory' },
  { name: 'trails', label: 'Trails' },
  { name: 'friends', label: 'Shared traces' },
  { name: 'leaveCairn', label: 'Leave cairn' },
  { name: 'hiking', label: 'Hiking' },
  { name: 'running', label: 'Running' },
  { name: 'layers', label: 'Layers' },
  { name: 'compass', label: 'Compass' },
  { name: 'personalTrace', label: 'Personal trace' },
  { name: 'otherTrace', label: 'Other trace' },
  { name: 'settings', label: 'Settings' },
];

function StatePanel({ night = false }: { night?: boolean }) {
  const ink = night ? '#DDE6E7' : '#31594A';
  const active = night ? '#A7CFA9' : '#2F684F';
  const muted = night ? '#7F9296' : '#87958E';
  return (
    <View style={[s.panel, { backgroundColor: night ? '#182126' : '#F3F4EE', borderColor: night ? '#344147' : '#D8DED8' }]}>
      <Text style={[s.panelTitle, { color: night ? '#F0F4F2' : '#17372D' }]}>{night ? 'NIGHT' : 'DAY'}</Text>
      <Text style={[s.panelSub, { color: night ? '#9CACB0' : '#68766F' }]}>same geometry · semantic contrast</Text>
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
      <Text style={s.eyebrow}>CAIRNNZ · GATE 2</Text>
      <Text style={s.title}>Navigation & field controls</Text>
      <Text style={s.intro}>Mature trail pictograms: familiar operational silhouettes, precise CairnNZ route details, and restrained active information.</Text>
      <View style={s.panels}>
        <StatePanel />
        <StatePanel night />
      </View>
      <View style={s.scalePanel}>
        <View>
          <Text style={s.scaleTitle}>OPTICAL SCALE</Text>
          <Text style={s.scaleSub}>Optical weight is tuned at real size; touch geometry remains independent.</Text>
        </View>
        <View style={s.scaleRow}>
          {[18, 20, 22, 24].map((size) => (
            <View key={size} style={s.scaleCell}>
              <CairnIcon name="memory" size={size} color="#31594A" accent="#2F684F" active />
              <Text style={s.scaleLabel}>{size}px</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.ruleRow}>
        <Text style={s.rule}>ACTIVE adds a restrained semantic fill or endpoint—not bulk.</Text>
        <Text style={s.rule}>DAY/NIGHT keep identical geometry and change only semantic contrast.</Text>
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
