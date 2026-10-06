/**
 * LogViewer.tsx — Modal viewer for the in-memory connectivity/debug log
 * (services/connectivity-log.ts), with copy-to-clipboard support.
 *
 * Key exports: LogViewer
 * Known issues: None currently tracked.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import {
  getConnectivityLog,
  clearConnectivityLog,
  formatConnectivityLog,
  ConnectivityLogEntry,
  ConnectivityLogLevel,
} from '@/services/connectivity-log';
import { spacing, borderRadius } from '@/constants/spacing';
import { shadows } from '@/constants/shadows';
import { typography } from '@/constants/typography';

interface LogViewerProps {
  visible: boolean;
  onClose: () => void;
  onClear?: () => void;
  refreshTrigger?: number; // Trigger reload when this changes
}

export function LogViewer({ visible, onClose, onClear, refreshTrigger }: LogViewerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [logs, setLogs] = useState<ConnectivityLogEntry[]>([]);

  // In-memory, synchronous — no loading state needed.
  const loadLogs = () => {
    setLogs(getConnectivityLog().slice().reverse());
  };

  useEffect(() => {
    if (visible) {
      loadLogs();
    }
  }, [visible, refreshTrigger]);

  const handleClear = () => {
    clearConnectivityLog();
    setLogs([]);
    if (onClear) {
      onClear();
    }
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(formatConnectivityLog());
      showToast(t('toast.connectivityLogCopied'), 'success');
    } catch {
      showToast(t('errors.failedToCopyLog'), 'error');
    }
  };

  const getLogTypeColor = (level: ConnectivityLogLevel): string => {
    switch (level) {
      case 'DEBUG':
        return colors.textSecondary;
      case 'WARN':
        return colors.warning;
      case 'ERROR':
        return colors.error;
      default:
        return colors.primary; // INFO
    }
  };

  const getLogTypeLabel = (level: ConnectivityLogLevel): string => {
    switch (level) {
      case 'DEBUG':
        return t('screens.settings.logLevelDebug');
      case 'WARN':
        return t('screens.settings.logLevelWarn');
      case 'ERROR':
        return t('screens.settings.logLevelError');
      default:
        return t('screens.settings.logLevelInfo');
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    // ConnectivityLogEntry.timestamp is Date.now() — already milliseconds.
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          {/* Header */}
          <View
            style={[
              styles.header,
              { borderBottomColor: colors.surfaceOutline, backgroundColor: colors.surface },
            ]}
          >
            <Text
              style={[styles.title, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('screens.settings.logsTitle')}
            </Text>
            <View style={styles.headerButtons}>
              <TouchableOpacity
                onPress={handleCopy}
                style={styles.copyButton}
                disabled={logs.length === 0}
                accessibilityLabel={t('common.copy')}
              >
                <Ionicons
                  name="copy-outline"
                  size={20}
                  color={logs.length === 0 ? colors.textSecondary : colors.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClear}
                style={[styles.clearButton, { backgroundColor: colors.error }]}
                disabled={logs.length === 0}
              >
                <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
                <Text style={styles.clearButtonText}>{t('screens.settings.clearLogs')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Logs Content */}
          {logs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {t('screens.settings.noLogsAvailable')}
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
                {t('screens.settings.logsSessionOnly')}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
            >
              {logs.map((log) => (
                <View
                  key={log.id}
                  style={[
                    styles.logEntry,
                    {
                      backgroundColor: colors.background,
                      borderLeftColor: getLogTypeColor(log.level),
                    },
                  ]}
                >
                  <View style={styles.logHeader}>
                    <View style={styles.logHeaderLeft}>
                      <View
                        style={[
                          styles.logTypeBadge,
                          { backgroundColor: getLogTypeColor(log.level) },
                        ]}
                      >
                        <Text style={[styles.logTypeText, { color: colors.onAccent }]}>
                          {getLogTypeLabel(log.level)}
                        </Text>
                      </View>
                      <Text style={[styles.logTag, { color: colors.textSecondary }]}>
                        {log.tag}
                      </Text>
                    </View>
                    <Text style={[styles.logTimestamp, { color: colors.textSecondary }]}>
                      {formatTimestamp(log.timestamp)}
                    </Text>
                  </View>
                  <Text style={[styles.logMessage, { color: colors.text }]}>{log.message}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  container: {
    width: '100%',
    maxWidth: 800,
    height: '90%',
    maxHeight: '90%',
    borderRadius: borderRadius.large,
    overflow: 'hidden',
    ...shadows.card,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    flexShrink: 0,
  },
  title: {
    ...typography.h2,
    fontSize: 24,
    fontWeight: '700',
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  copyButton: {
    padding: 8,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.small,
  },
  clearButtonText: {
    ...typography.bodyMedium,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.bodyMedium,
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  emptySubtext: {
    ...typography.bodyMedium,
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  logEntry: {
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.small,
    borderLeftWidth: 4,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  logHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  logTypeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.small,
  },
  logTypeText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  logTag: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  logTimestamp: {
    ...typography.caption,
    fontSize: 12,
  },
  logMessage: {
    ...typography.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
  },
});
