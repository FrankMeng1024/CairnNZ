// OTAControlPanel.tsx — runtime debug panel for Unity shader globals.
//
// HOW TO OPEN: 3-finger tap anywhere on the AR view (or hold the panel handle).
// HOW TO CLOSE: tap the ✕ button or 3-finger tap again.
//
// While open: a translucent right-side drawer overlays the AR view (AR keeps
// rendering in the background — no unmount, no GL reset). Each row is a
// label + slider + numeric readout. Sliders push live values into Unity via
// CairnBridge.OnSetGlobal — effects appear in real time.
//
// All globals are listed in PORTAL_GLOBALS below. Each has min/max/default
// matching CairnGlobals.cs. Long-press a row to reset that single value.
// Long-press the title to reset ALL.

import React, { useState, useCallback, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  Dimensions,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';

export interface OTAGlobalDef {
  name: string;        // matches CairnGlobals.Set() switch case
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number;       // for slider
}

// Mirrors CairnGlobals.cs constants — keep these in sync.
export const PORTAL_GLOBALS: OTAGlobalDef[] = [
  // — Base atmosphere —
  { name: 'BloomScale',     label: 'Bloom intensity',    min: 0.3,  max: 2.0,  def: 1.0, step: 0.05 },
  { name: 'Alpha',          label: 'Overall alpha',      min: 0.05, max: 1.0,  def: 1.0, step: 0.05 },
  { name: 'ScrollMul',      label: 'Animation speed',    min: 0.0,  max: 2.0,  def: 1.0, step: 0.05 },
  { name: 'BreathFreq',     label: 'Breath frequency',   min: 0.0,  max: 2.0,  def: 1.0, step: 0.05 },
  { name: 'AmbientLux',     label: 'Ambient light',      min: 0.0,  max: 3.0,  def: 1.0, step: 0.1  },

  // — Portal ring —
  { name: 'SigilIntensity', label: 'Sigil glow',         min: 0.0,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'PortalSpin',     label: 'Portal spin',        min: 0.0,  max: 4.0,  def: 1.0, step: 0.05 },
  { name: 'PortalScale',    label: 'Portal size',        min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'IconScale',      label: 'Icon size',          min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'HaloIntensity',  label: 'Ground halo',        min: 0.0,  max: 3.0,  def: 1.0, step: 0.05 },

  // — Wisps / strands —
  { name: 'WispIntensity',  label: 'Wisp brightness',    min: 0.0,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'WispCountMul',   label: 'Wisp count ×',       min: 0.0,  max: 2.0,  def: 1.0, step: 0.05 },
  { name: 'WispThickness',  label: 'Wisp thickness',     min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'WispHeight',     label: 'Wisp height',        min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'WispFadeNear',   label: 'Wisp fade near',     min: 0.1,  max: 5.0,  def: 1.0, step: 0.05 },
  { name: 'WispFadeFar',    label: 'Wisp fade far',      min: 0.1,  max: 5.0,  def: 1.0, step: 0.05 },
  { name: 'BubbleSpeed',    label: 'Bubble speed',       min: 0.1,  max: 4.0,  def: 1.0, step: 0.05 },
  { name: 'BubbleSize',     label: 'Bubble size',        min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },

  // — Fireflies —
  { name: 'FireflyRate',    label: 'Firefly density',    min: 0.0,  max: 3.0,  def: 1.0, step: 0.05 },

  // — Text —
  { name: 'TextScale',      label: 'Text size',          min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'TextHeight',     label: 'Text height',        min: 0.3,  max: 3.0,  def: 1.0, step: 0.05 },
  { name: 'TextAlpha',      label: 'Text opacity',       min: 0.0,  max: 1.0,  def: 1.0, step: 0.05 },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  setGlobal: (name: string, value: number) => void;
}

export function OTAControlPanel({ visible, onClose, setGlobal }: Props) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(PORTAL_GLOBALS.map(g => [g.name, g.def]))
  );

  const update = useCallback(
    (name: string, val: number) => {
      setValues(prev => ({ ...prev, [name]: val }));
      setGlobal(name, val);
    },
    [setGlobal],
  );

  const resetAll = useCallback(() => {
    PORTAL_GLOBALS.forEach(g => {
      setGlobal(g.name, g.def);
    });
    setValues(Object.fromEntries(PORTAL_GLOBALS.map(g => [g.name, g.def])));
  }, [setGlobal]);

  const winH = Dimensions.get('window').height;

  if (!visible) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Tap outside to close — swallow events on the drawer itself. */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[styles.drawer, { maxHeight: winH * 0.85 }]}>
        <Pressable onLongPress={resetAll}>
          <View style={styles.header}>
            <Text style={styles.title}>Cairn FX OTA</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>long-press title to reset all</Text>
        </Pressable>
        <ScrollView style={styles.scroll}>
          {PORTAL_GLOBALS.map(g => (
            <Row
              key={g.name}
              def={g}
              value={values[g.name]}
              onChange={v => update(g.name, v)}
              onReset={() => update(g.name, g.def)}
            />
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </View>
  );
}

interface RowProps {
  def: OTAGlobalDef;
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
}

function Row({ def, value, onChange, onReset }: RowProps) {
  return (
    <Pressable onLongPress={onReset}>
      <View style={styles.row}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowLabel}>{def.label}</Text>
          <Text style={styles.rowValue}>{value.toFixed(2)}</Text>
        </View>
        <InlineSlider
          min={def.min}
          max={def.max}
          step={def.step ?? 0.05}
          value={value}
          onChange={onChange}
        />
      </View>
    </Pressable>
  );
}

interface InlineSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

/**
 * Pure-RN slider built on PanResponder + measured layout — no native dep.
 * Tracks finger across the bar and snaps to step. Visually a thin track
 * with a ~14px thumb.
 */
function InlineSlider({ min, max, step, value, onChange }: InlineSliderProps) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  }, []);

  const apply = useCallback(
    (locX: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const t = Math.max(0, Math.min(1, locX / w));
      let raw = min + t * (max - min);
      if (step > 0) raw = Math.round(raw / step) * step;
      raw = Math.max(min, Math.min(max, raw));
      onChange(raw);
    },
    [min, max, step, onChange],
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => apply(e.nativeEvent.locationX),
      onPanResponderMove: e => apply(e.nativeEvent.locationX),
    }),
  ).current;

  const tFill = width > 0 ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const fillW = tFill * width;
  const thumbX = Math.max(0, Math.min(width - 14, fillW - 7));

  return (
    <View style={sliderStyles.wrap} onLayout={onLayout} {...responder.panHandlers}>
      <View style={sliderStyles.track} />
      <View style={[sliderStyles.fill, { width: fillW }]} />
      <View style={[sliderStyles.thumb, { left: thumbX }]} />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 28,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#5dd3ff',
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#5dd3ff',
    shadowColor: '#5dd3ff',
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 3,
  },
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 9999,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  drawer: {
    width: 280,
    backgroundColor: 'rgba(15,18,28,0.92)',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    marginTop: 60,
    marginBottom: 24,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  close: { color: '#fff', fontSize: 18, paddingHorizontal: 6 },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginBottom: 8 },
  scroll: { },
  row: { paddingVertical: 6 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { color: '#cdd5e1', fontSize: 12 },
  rowValue: { color: '#5dd3ff', fontSize: 12, fontVariant: ['tabular-nums'] },
});
