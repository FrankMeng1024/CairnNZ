import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Icon, type IconName } from '../Icon';
import { Colors, FontSize, RadiusRole, Shadow, Spacing } from '../tokens';
import { useVisualTheme } from '../../hooks/useVisualTheme';

export type ActivityRecordingMode = 'hike' | 'run';
export type ActivityRecordingPhase = 'ready' | 'starting' | 'tracking' | 'paused' | 'finishing';
export type ActivityStatusTone = 'healthy' | 'warning' | 'danger' | 'info' | 'muted';

export interface ActivityMetricPresentation {
  label: string;
  value: string;
  unit?: string;
}

export interface ActivityNoticePresentation {
  label: string;
  tone: ActivityStatusTone;
  icon?: IconName;
}

function modePresentation(mode: ActivityRecordingMode, themePrimary: string) {
  return mode === 'run'
    ? { label: 'Run', icon: 'Footprints' as const, color: Colors.running }
    : { label: 'Hike', icon: 'Mountain' as const, color: themePrimary };
}

function phaseLabel(phase: ActivityRecordingPhase) {
  switch (phase) {
    case 'starting': return 'Starting';
    case 'tracking': return 'Recording';
    case 'paused': return 'Paused';
    case 'finishing': return 'Finishing';
    default: return 'Ready';
  }
}

function toneColor(tone: ActivityStatusTone, theme: ReturnType<typeof useVisualTheme>) {
  switch (tone) {
    case 'healthy': return theme.iconActive;
    case 'warning': return Colors.severityWarning;
    case 'danger': return theme.destructive;
    case 'info': return Colors.info;
    default: return theme.iconInactive;
  }
}

export function ActivityTopChrome({
  mode,
  phase,
  safeTop,
  gpsLabel,
  gpsTone,
  onBack,
  primaryMetric,
  secondaryMetrics = [],
  notices = [],
}: {
  mode: ActivityRecordingMode;
  phase: ActivityRecordingPhase;
  safeTop: number;
  gpsLabel: string;
  gpsTone: ActivityStatusTone;
  onBack: () => void;
  primaryMetric?: ActivityMetricPresentation;
  secondaryMetrics?: ActivityMetricPresentation[];
  notices?: ActivityNoticePresentation[];
}) {
  const theme = useVisualTheme();
  const modeMeta = modePresentation(mode, theme.primaryAction);
  const signalColor = toneColor(gpsTone, theme);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.topLayer, { paddingTop: safeTop + Spacing.sm }]}
      testID={`activity-${mode}-top-chrome`}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.mapOverlay,
            borderColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.78}
          style={styles.backAction}
          accessibilityRole="button"
          accessibilityLabel={`Back from ${modeMeta.label}`}
        >
          <Icon name="ChevronLeft" size={21} color={theme.icon} strokeWidth={2.4} />
          <Text style={[styles.backLabel, { color: theme.foregroundSecondary }]}>Back</Text>
        </TouchableOpacity>

        <View style={styles.identity} pointerEvents="none">
          <View style={styles.identityTitleRow}>
            <Icon name={modeMeta.icon} size={15} color={modeMeta.color} strokeWidth={2.2} />
            <Text style={[styles.identityTitle, { color: theme.foreground }]}>{modeMeta.label}</Text>
          </View>
          <Text
            style={[
              styles.identityState,
              { color: phase === 'paused' ? Colors.severityWarning : theme.foregroundSecondary },
            ]}
          >
            {phaseLabel(phase)}
          </Text>
        </View>

        <View
          style={[styles.signalChip, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
          accessibilityLabel={`Location status: ${gpsLabel}`}
        >
          <View style={[styles.signalDot, { backgroundColor: signalColor }]} />
          <Text style={[styles.signalLabel, { color: theme.foreground }]} numberOfLines={1}>
            {gpsLabel}
          </Text>
        </View>
      </View>

      {primaryMetric ? (
        <View
          style={[
            styles.metrics,
            {
              backgroundColor: theme.mapOverlay,
              borderColor: phase === 'paused' ? Colors.severityWarning : theme.border,
              shadowColor: theme.shadow,
            },
          ]}
          pointerEvents="none"
          testID={`activity-${mode}-metrics`}
        >
          <View style={styles.primaryMetric}>
            <Text style={[styles.metricEyebrow, { color: theme.muted }]}>{primaryMetric.label}</Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.primaryMetricValue, { color: theme.foreground }]} numberOfLines={1}>
                {primaryMetric.value}
              </Text>
              {primaryMetric.unit ? (
                <Text style={[styles.primaryMetricUnit, { color: theme.foregroundSecondary }]}>
                  {primaryMetric.unit}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />
          <View style={styles.secondaryMetricRow}>
            {secondaryMetrics.slice(0, 2).map((metric) => (
              <View key={metric.label} style={styles.secondaryMetric}>
                <Text style={[styles.metricEyebrow, { color: theme.muted }]}>{metric.label}</Text>
                <View style={styles.metricValueRow}>
                  <Text style={[styles.secondaryMetricValue, { color: theme.foreground }]} numberOfLines={1}>
                    {metric.value}
                  </Text>
                  {metric.unit ? (
                    <Text style={[styles.secondaryMetricUnit, { color: theme.foregroundSecondary }]}>
                      {metric.unit}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {notices.length > 0 ? (
        <View style={styles.noticeStack} pointerEvents="none">
          {notices.slice(0, 2).map((notice) => {
            const color = toneColor(notice.tone, theme);
            return (
              <View
                key={notice.label}
                style={[styles.notice, { backgroundColor: theme.mapOverlay, borderColor: color }]}
              >
                {notice.icon ? <Icon name={notice.icon} size={13} color={color} strokeWidth={2.4} /> : (
                  <View style={[styles.noticeDot, { backgroundColor: color }]} />
                )}
                <Text style={[styles.noticeText, { color: theme.foreground }]} numberOfLines={1}>
                  {notice.label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function ActivityStartDock({
  mode,
  safeBottom,
  routeName,
  routeDescription,
  readinessLabel,
  readinessTone,
  backgroundWarning,
  onChooseRoute,
  onStart,
  onOpenSettings,
  starting = false,
  startError,
}: {
  mode: ActivityRecordingMode;
  safeBottom: number;
  routeName: string;
  routeDescription: string;
  readinessLabel: string;
  readinessTone: ActivityStatusTone;
  backgroundWarning?: string | null;
  onChooseRoute: () => void;
  onStart: () => void;
  onOpenSettings?: () => void;
  starting?: boolean;
  startError?: string | null;
}) {
  const theme = useVisualTheme();
  const modeMeta = modePresentation(mode, theme.primaryAction);
  const readinessColor = toneColor(readinessTone, theme);
  const startColor = mode === 'run' ? Colors.running : theme.primaryAction;
  const startForeground = mode === 'run' ? '#FFFFFF' : theme.onPrimary;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.bottomLayer, { paddingBottom: safeBottom + Spacing.sm }]}
      testID={`activity-${mode}-start-dock`}
    >
      <View
        style={[
          styles.startDock,
          { backgroundColor: theme.mapOverlay, borderColor: theme.border, shadowColor: theme.shadow },
        ]}
      >
        <TouchableOpacity
          onPress={onChooseRoute}
          activeOpacity={0.82}
          style={styles.routeChoice}
          accessibilityRole="button"
          accessibilityLabel={`Choose route. Current selection: ${routeName}`}
        >
          <View style={[styles.modeGlyph, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}> 
            <Icon name={modeMeta.icon} size={22} color={modeMeta.color} strokeWidth={2.1} />
          </View>
          <View style={styles.routeText}>
            <Text style={[styles.routeEyebrow, { color: modeMeta.color }]}>
              {mode === 'run' ? 'RUN' : 'HIKE'}
            </Text>
            <Text style={[styles.routeName, { color: theme.foreground }]} numberOfLines={1}>
              {routeName}
            </Text>
            <Text style={[styles.routeDescription, { color: theme.foregroundSecondary }]} numberOfLines={1}>
              {routeDescription}
            </Text>
          </View>
          <View style={[styles.routeChevron, { backgroundColor: theme.surfaceSecondary }]}> 
            <Icon name="ChevronUp" size={18} color={theme.icon} strokeWidth={2.2} />
          </View>
        </TouchableOpacity>

        <View style={[styles.readinessRow, { borderTopColor: theme.border }]}> 
          <View style={[styles.readinessDot, { backgroundColor: readinessColor }]} />
          <Text style={[styles.readinessText, { color: theme.foregroundSecondary }]} numberOfLines={1}>
            {readinessLabel}
          </Text>
        </View>

        {backgroundWarning ? (
          <TouchableOpacity
            disabled={!onOpenSettings}
            onPress={onOpenSettings}
            activeOpacity={0.78}
            style={[styles.backgroundWarning, { backgroundColor: theme.surfaceSecondary }]}
            accessibilityRole={onOpenSettings ? 'button' : undefined}
            accessibilityLabel={backgroundWarning}
          >
            <Icon name="CloudOff" size={14} color={Colors.severityWarning} strokeWidth={2.2} />
            <Text style={[styles.backgroundWarningText, { color: theme.foreground }]} numberOfLines={2}>
              {backgroundWarning}
            </Text>
            {onOpenSettings ? <Text style={[styles.settingsLabel, { color: modeMeta.color }]}>Settings</Text> : null}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={onStart}
          disabled={starting}
          activeOpacity={0.86}
          style={[
            styles.startButton,
            { backgroundColor: starting ? theme.disabledSurface : startColor },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: starting, busy: starting }}
          accessibilityLabel={starting ? `Starting ${mode}` : `Start ${mode}`}
        >
          <Icon name="Play" size={19} color={starting ? theme.disabledText : startForeground} strokeWidth={2.5} />
          <Text style={[styles.startButtonText, { color: starting ? theme.disabledText : startForeground }]}> 
            {starting ? 'Starting…' : mode === 'run' ? 'Start Running' : 'Start Hiking'}
          </Text>
        </TouchableOpacity>

        {startError ? (
          <Text style={[styles.startError, { color: theme.destructive }]} accessibilityRole="alert">
            {startError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ActivityControlDock({
  mode,
  phase,
  safeBottom,
  backgroundWarning,
  cairnDisabled = false,
  onPauseResume,
  onCairn,
  onFinish,
}: {
  mode: ActivityRecordingMode;
  phase: 'tracking' | 'paused' | 'finishing';
  safeBottom: number;
  backgroundWarning?: string | null;
  cairnDisabled?: boolean;
  onPauseResume: () => void;
  onCairn: () => void;
  onFinish: () => void;
}) {
  const theme = useVisualTheme();
  const modeMeta = modePresentation(mode, theme.primaryAction);
  const paused = phase === 'paused';
  const finishing = phase === 'finishing';
  const primaryColor = mode === 'run' ? Colors.running : theme.primaryAction;
  const primaryForeground = mode === 'run' ? '#FFFFFF' : theme.onPrimary;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.bottomLayer, { paddingBottom: safeBottom + Spacing.sm }]}
      testID={`activity-${mode}-control-dock`}
    >
      <View
        style={[
          styles.controlDock,
          {
            backgroundColor: theme.mapOverlay,
            borderColor: paused ? Colors.severityWarning : theme.border,
            shadowColor: theme.shadow,
          },
        ]}
      >
        <View style={styles.recordingStateRow} pointerEvents="none">
          <View
            style={[
              styles.recordingStateDot,
              { backgroundColor: paused ? Colors.severityWarning : finishing ? theme.iconInactive : modeMeta.color },
            ]}
          />
          <Text style={[styles.recordingStateTitle, { color: theme.foreground }]}> 
            {finishing ? 'Completing activity' : paused ? 'Activity paused' : 'Recording activity'}
          </Text>
          <Text style={[styles.recordingStateHint, { color: theme.muted }]} numberOfLines={1}>
            {finishing ? 'Securing your route' : paused ? 'Time and route are held' : 'GPS evidence is saved as you move'}
          </Text>
        </View>

        {backgroundWarning ? (
          <View style={[styles.compactWarning, { backgroundColor: theme.surfaceSecondary }]} pointerEvents="none">
            <Icon name="CloudOff" size={13} color={Colors.severityWarning} strokeWidth={2.2} />
            <Text style={[styles.compactWarningText, { color: theme.foreground }]} numberOfLines={1}>
              {backgroundWarning}
            </Text>
          </View>
        ) : null}

        <View style={styles.controlRow}>
          <TouchableOpacity
            onPress={onPauseResume}
            disabled={finishing}
            activeOpacity={0.84}
            style={[
              styles.primaryControl,
              { backgroundColor: finishing ? theme.disabledSurface : primaryColor },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: finishing }}
            accessibilityLabel={paused ? `Resume ${mode}` : `Pause ${mode}`}
          >
            <Icon
              name={paused ? 'Play' : 'Pause'}
              size={20}
              color={finishing ? theme.disabledText : primaryForeground}
              strokeWidth={2.4}
            />
            <Text style={[styles.primaryControlText, { color: finishing ? theme.disabledText : primaryForeground }]}> 
              {paused ? 'Resume' : 'Pause'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onCairn}
            disabled={cairnDisabled || finishing}
            activeOpacity={0.8}
            style={[
              styles.secondaryControl,
              {
                backgroundColor: theme.secondaryAction,
                borderColor: theme.borderStrong,
                opacity: cairnDisabled || finishing ? 0.46 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: cairnDisabled || finishing }}
            accessibilityLabel={mode === 'run' ? 'Quick Cairn' : 'Plant a Cairn'}
          >
            <Icon name="Flag" size={19} color={modeMeta.color} strokeWidth={2.1} />
            <Text style={[styles.secondaryControlText, { color: theme.foreground }]}> 
              {mode === 'run' ? 'Cairn' : 'Plant'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onFinish}
            disabled={finishing}
            activeOpacity={0.8}
            style={[
              styles.finishControl,
              { backgroundColor: theme.secondaryAction, borderColor: theme.borderStrong },
              finishing && { opacity: 0.46 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: finishing }}
            accessibilityLabel={`Finish ${mode}`}
          >
            <Icon name="Square" size={17} color={theme.foregroundSecondary} strokeWidth={2.3} />
            <Text style={[styles.finishControlText, { color: theme.foregroundSecondary }]}>Finish</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export function ActivityRecenterButton({
  mode,
  safeBottom,
  raised = false,
  onPress,
}: {
  mode: ActivityRecordingMode;
  safeBottom: number;
  raised?: boolean;
  onPress: () => void;
}) {
  const theme = useVisualTheme();
  const modeMeta = modePresentation(mode, theme.primaryAction);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={[
        styles.recenter,
        {
          bottom: safeBottom + (raised ? 170 : 132),
          backgroundColor: theme.mapOverlay,
          borderColor: theme.border,
          shadowColor: theme.shadow,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Recenter map on current location"
      testID={`activity-${mode}-recenter`}
    >
      <Icon name="Target" size={21} color={modeMeta.color} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: Spacing.md,
  },
  header: {
    minHeight: 58,
    borderRadius: RadiusRole.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    ...Shadow.card,
  },
  backAction: {
    minWidth: 76,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  backLabel: { fontSize: FontSize.caption, fontWeight: '600' },
  identity: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  identityTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  identityTitle: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: -0.2 },
  identityState: { fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 0.45, textTransform: 'uppercase' },
  signalChip: {
    minWidth: 76,
    maxWidth: 104,
    minHeight: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  signalDot: { width: 7, height: 7, borderRadius: 4 },
  signalLabel: { flexShrink: 1, fontSize: 11, fontWeight: '700' },
  metrics: {
    marginTop: Spacing.sm,
    minHeight: 86,
    borderRadius: RadiusRole.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    ...Shadow.card,
  },
  primaryMetric: { flex: 1.16, justifyContent: 'center', minWidth: 0 },
  metricEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 1.05 },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 0 },
  primaryMetricValue: { fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -1.1, fontVariant: ['tabular-nums'], flexShrink: 1 },
  primaryMetricUnit: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: Spacing.base },
  secondaryMetricRow: { flex: 1.45, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  secondaryMetric: { flex: 1, minWidth: 0, justifyContent: 'center' },
  secondaryMetricValue: { fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: -0.35, fontVariant: ['tabular-nums'], flexShrink: 1 },
  secondaryMetricUnit: { fontSize: 10, lineHeight: 15, fontWeight: '600' },
  noticeStack: { marginTop: Spacing.sm, gap: 5, alignItems: 'flex-start' },
  notice: {
    maxWidth: '100%',
    minHeight: 32,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: Spacing.md,
    ...Shadow.card,
  },
  noticeDot: { width: 7, height: 7, borderRadius: 4 },
  noticeText: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  bottomLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
    paddingHorizontal: Spacing.md,
  },
  startDock: {
    borderRadius: 24,
    borderWidth: 1,
    padding: Spacing.base,
    gap: Spacing.sm,
    ...Shadow.overlay,
  },
  routeChoice: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  modeGlyph: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  routeText: { flex: 1, minWidth: 0 },
  routeEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 1.2 },
  routeName: { fontSize: 19, lineHeight: 24, fontWeight: '800', letterSpacing: -0.35 },
  routeDescription: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  routeChevron: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  readinessRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    minHeight: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  readinessDot: { width: 7, height: 7, borderRadius: 4 },
  readinessText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  backgroundWarning: { minHeight: 38, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 7 },
  backgroundWarningText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  settingsLabel: { fontSize: 11, fontWeight: '800' },
  startButton: { minHeight: 58, borderRadius: RadiusRole.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  startButtonText: { fontSize: 17, lineHeight: 22, fontWeight: '800', letterSpacing: 0.1 },
  startError: { textAlign: 'center', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  controlDock: {
    borderRadius: 24,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.overlay,
  },
  recordingStateRow: { minHeight: 23, flexDirection: 'row', alignItems: 'center', gap: 7 },
  recordingStateDot: { width: 8, height: 8, borderRadius: 4 },
  recordingStateTitle: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  recordingStateHint: { flex: 1, textAlign: 'right', fontSize: 10, lineHeight: 15, fontWeight: '500' },
  compactWarning: { minHeight: 30, borderRadius: 10, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 7 },
  compactWarningText: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  controlRow: { minHeight: 56, flexDirection: 'row', gap: Spacing.sm },
  primaryControl: { flex: 1.25, minWidth: 0, borderRadius: RadiusRole.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryControlText: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  secondaryControl: { flex: 1, minWidth: 0, borderRadius: RadiusRole.button, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  secondaryControlText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  finishControl: { flex: 0.88, minWidth: 0, borderRadius: RadiusRole.button, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  finishControlText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  recenter: {
    position: 'absolute',
    right: Spacing.md,
    zIndex: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
});
