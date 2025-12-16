import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Pressable,
  View as RNView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { PortInfo } from '@remote-claude/shared-types';

interface PortsModalProps {
  visible: boolean;
  hostId: string;
  hostName: string;
  ports: PortInfo[];
  netTool?: string;
  netToolError?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function PortsModal({
  visible,
  hostName,
  ports,
  netTool,
  netToolError,
  loading,
  error,
  onClose,
  onRefresh,
}: PortsModalProps) {
  const colors = useThemeColors();

  // Sort ports by port number
  const sortedPorts = [...ports].sort((a, b) => a.port - b.port);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return colors.success;
      case 'refused':
        return colors.warning;
      case 'timeout':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const getStatusIcon = (status: string): keyof typeof Ionicons.glyphMap => {
    switch (status) {
      case 'active':
        return 'checkmark-circle';
      case 'refused':
        return 'close-circle';
      case 'timeout':
        return 'time';
      default:
        return 'help-circle';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            Ports Scanner
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {hostName}
          </Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </RNView>

        {loading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Scanning ports...
            </Text>
          </RNView>
        ) : error ? (
          <RNView style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={48} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>
              {error}
            </Text>
          </RNView>
        ) : (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {/* Network Tool Banner */}
            {netTool && (
              <RNView style={[styles.banner, { backgroundColor: colors.success + '15', borderColor: colors.success + '30' }]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.bannerText, { color: colors.success }]}>
                  Using <Text style={[styles.bannerBold, { color: colors.success }]}>{netTool}</Text> for process detection
                </Text>
              </RNView>
            )}

            {netToolError && (
              <RNView style={[styles.banner, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '30' }]}>
                <Ionicons name="warning" size={18} color={colors.warning} />
                <Text style={[styles.bannerText, { color: colors.warning }]}>
                  {netToolError}
                </Text>
              </RNView>
            )}

            {/* Info Banner */}
            <RNView style={[styles.banner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
              <Ionicons name="information-circle" size={18} color={colors.primary} />
              <Text style={[styles.bannerText, { color: colors.primary }]}>
                Scanning AgentAPI ports 3284-3299
              </Text>
            </RNView>

            {/* Port Count */}
            <Text style={[styles.countText, { color: colors.textSecondary }]}>
              {sortedPorts.length} port{sortedPorts.length !== 1 ? 's' : ''} detected
            </Text>

            {/* Ports List */}
            {sortedPorts.length === 0 ? (
              <RNView style={styles.emptyContainer}>
                <Ionicons name="radio-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No active ports in range
                </Text>
              </RNView>
            ) : (
              sortedPorts.map(port => (
                <RNView
                  key={port.port}
                  style={[styles.portCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  {/* Port Header */}
                  <RNView style={styles.portHeader}>
                    <RNView style={styles.portTitleRow}>
                      <Ionicons
                        name={getStatusIcon(port.status)}
                        size={20}
                        color={getStatusColor(port.status)}
                      />
                      <Text style={[styles.portNumber, { color: colors.text }]}>
                        Port {port.port}
                      </Text>
                    </RNView>
                    <RNView style={[styles.statusBadge, { backgroundColor: getStatusColor(port.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(port.status) }]}>
                        {port.status}
                      </Text>
                    </RNView>
                  </RNView>

                  {/* DB Mapping Info */}
                  {(port.processId || port.processName || port.processType) && (
                    <RNView style={[styles.infoSection, { borderTopColor: colors.border }]}>
                      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                        Known Process (from DB)
                      </Text>
                      {port.processId && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          ID: <Text style={[styles.monospace, { color: colors.text }]}>{port.processId}</Text>
                        </Text>
                      )}
                      {port.processName && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          Name: {port.processName}
                        </Text>
                      )}
                      {port.processType && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          Type: {port.processType}
                        </Text>
                      )}
                    </RNView>
                  )}

                  {/* Network Tool Info */}
                  {(port.netPid || port.netProcess || port.netUser) && (
                    <RNView style={[styles.infoSection, { borderTopColor: colors.border }]}>
                      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                        {netTool ? `From ${netTool}` : 'Network Info'}
                      </Text>
                      {port.netPid && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          PID: <Text style={[styles.monospace, { color: colors.text }]}>{port.netPid}</Text>
                        </Text>
                      )}
                      {port.netProcess && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          Process: <Text style={[styles.monospace, { color: colors.text }]}>{port.netProcess}</Text>
                        </Text>
                      )}
                      {port.netUser && (
                        <Text style={[styles.infoText, { color: colors.text }]}>
                          User: {port.netUser}
                        </Text>
                      )}
                    </RNView>
                  )}

                  {/* No info available */}
                  {!port.processId && !port.netPid && (
                    <RNView style={[styles.infoSection, { borderTopColor: colors.border }]}>
                      <Text style={[styles.noInfoText, { color: colors.textSecondary }]}>
                        No process information available
                      </Text>
                    </RNView>
                  )}
                </RNView>
              ))
            )}
          </ScrollView>
        )}

        {/* Footer */}
        <RNView style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable
            style={[styles.footerButton, styles.refreshButton, { borderColor: colors.primary }]}
            onPress={onRefresh}
            disabled={loading}
          >
            <Ionicons name="refresh" size={18} color={colors.primary} />
            <Text style={[styles.refreshButtonText, { color: colors.primary }]}>Refresh</Text>
          </Pressable>
          <Pressable
            style={[styles.footerButton, styles.closeFooterButton, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </RNView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
  },
  bannerBold: {
    fontWeight: '600',
  },
  countText: {
    fontSize: 12,
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
  portCard: {
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  portHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  portTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  portNumber: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  infoSection: {
    padding: 12,
    borderTopWidth: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 13,
    marginBottom: 4,
  },
  monospace: {
    fontFamily: 'SpaceMono',
  },
  noInfoText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  footerButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  refreshButton: {
    borderWidth: 1,
  },
  refreshButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeFooterButton: {},
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
