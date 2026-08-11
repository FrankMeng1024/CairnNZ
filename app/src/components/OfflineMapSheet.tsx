/**
 * OfflineMapSheet — Download manager for offline tile packs.
 * Presented as a modal sheet from MapScreen.
 *
 * Sprint 43 — STORY-00141
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon } from '../components/Icon';
import { GlassPanel, Elevation } from '../components/GlassPanel';
import { NZ_OFFLINE_PACKS, type OfflinePack } from '../config/offlinePacks';
import {
  getDownloadedPacks, downloadPack, deletePack, pausePack, resumePack,
  type DownloadedPackInfo,
} from '../services/offlineMapService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function OfflineMapSheet({ visible, onClose }: Props) {
  const [downloadedPacks, setDownloadedPacks] = useState<DownloadedPackInfo[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    if (visible) loadPacks();
  }, [visible]);

  const loadPacks = async () => {
    const packs = await getDownloadedPacks();
    setDownloadedPacks(packs);
  };

  const handleDownload = useCallback(async (pack: OfflinePack) => {
    setDownloadingId(pack.id);
    await downloadPack(
      pack,
      (id, prog) => {
        setProgress(prev => ({ ...prev, [id]: prog }));
        if (prog >= 100) {
          setDownloadingId(null);
          loadPacks();
        }
      },
      (id, error) => {
        setDownloadingId(null);
        Alert.alert("Couldn't download this map pack", 'Check your Wi-Fi or try a smaller region.', [{ text: 'OK' }]);
      },
    );
  }, []);

  const handleDelete = useCallback((packId: string, name: string) => {
    Alert.alert(
      'Delete Pack',
      `Remove "${name}" offline map? You can re-download later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePack(packId);
            await loadPacks();
          },
        },
      ],
    );
  }, []);

  if (!visible) return null;

  const getPackStatus = (packId: string): DownloadedPackInfo | undefined => {
    return downloadedPacks.find(p => p.id === packId);
  };

  const renderPack = ({ item }: { item: OfflinePack }) => {
    const status = getPackStatus(item.id);
    const isDownloaded = status?.status === 'complete';
    const isDownloading = downloadingId === item.id;
    const currentProgress = progress[item.id] ?? status?.progress ?? 0;

    return (
      <View style={[styles.packCard, Elevation[2]]}>
        <View style={styles.packHeader}>
          <View style={styles.packInfo}>
            <Text style={styles.packName}>{item.name}</Text>
            <Text style={styles.packDesc}>{item.description}</Text>
            <Text style={styles.packSize}>
              {isDownloaded ? '✓ Downloaded' : `~${item.estimatedSizeMB} MB`}
              {' · '}Zoom {item.minZoom}–{item.maxZoom}
            </Text>
          </View>
          {isDownloaded ? (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item.id, item.name)}
            >
              <Icon name="Trash2" size={18} color={Colors.danger} />
            </TouchableOpacity>
          ) : isDownloading ? (
            <TouchableOpacity
              style={styles.pauseBtn}
              onPress={() => { pausePack(item.id); setDownloadingId(null); }}
            >
              <Icon name="Pause" size={18} color={Colors.severityCaution} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={() => handleDownload(item)}
            >
              <Icon name="Download" size={18} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        {isDownloading && (
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${currentProgress}%` }]} />
            <Text style={styles.progressText}>{currentProgress.toFixed(0)}%</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.container}>
        <GlassPanel intensity={20} tint="light" style={styles.sheet} borderRadius={24}>
          <View style={styles.header}>
            <Text style={styles.title}>Offline Maps</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="X" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            Download regions for offline use. Maps work without internet.
          </Text>
          <FlatList
            data={NZ_OFFLINE_PACKS}
            keyExtractor={item => item.id}
            renderItem={renderPack}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </GlassPanel>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayDark, // cream tint (token renamed semantically)
    justifyContent: 'flex-end',
  },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', padding: Spacing.lg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  title: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary },
  closeBtn: { padding: Spacing.sm },
  subtitle: {
    fontSize: FontSize.body, color: Colors.textSecondary, marginBottom: Spacing.lg,
  },
  list: { gap: Spacing.md, paddingBottom: Spacing.xl },
  packCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md,
  },
  packHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  packInfo: { flex: 1, marginRight: Spacing.md },
  packName: { fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary },
  packDesc: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 2 },
  packSize: { fontSize: FontSize.small, color: Colors.textMuted, marginTop: 4 },
  downloadBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  pauseBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.severityCautionBg, alignItems: 'center', justifyContent: 'center',
  },
  deleteBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.dangerBg, alignItems: 'center', justifyContent: 'center',
  },
  progressBar: {
    marginTop: Spacing.sm, height: 6, backgroundColor: Colors.border,
    borderRadius: 3, overflow: 'hidden', position: 'relative',
  },
  progressFill: {
    height: '100%', backgroundColor: Colors.primary, borderRadius: 3,
  },
  progressText: {
    position: 'absolute', right: 0, top: -16,
    fontSize: FontSize.tiny, color: Colors.textMuted,
  },
});
