import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Pressable,
  View as RNView,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { EnvVar } from '@remote-claude/shared-types';

interface ProcessEnvModalProps {
  visible: boolean;
  processName: string;
  vars: EnvVar[];
  loading?: boolean;
  error?: string;
  onClose: () => void;
}

export function ProcessEnvModal({
  visible,
  processName,
  vars,
  loading,
  error,
  onClose,
}: ProcessEnvModalProps) {
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Reset search when modal opens
  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setExpandedKeys(new Set());
    }
  }, [visible]);

  // Filter vars by search
  const filteredVars = vars.filter(v =>
    v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
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
            Shell Environment
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {processName}
          </Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </RNView>

        {loading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading environment variables...
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
            {/* Info Banner */}
            <RNView style={[styles.infoBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
              <Ionicons name="information-circle" size={18} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                These are the environment variables exposed to this shell process. They are read-only.
              </Text>
            </RNView>

            {/* Search */}
            <RNView style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search variables..."
                placeholderTextColor={colors.textSecondary}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </Pressable>
              )}
            </RNView>

            {/* Count */}
            <Text style={[styles.countText, { color: colors.textSecondary }]}>
              {filteredVars.length} variable{filteredVars.length !== 1 ? 's' : ''}
              {searchQuery ? ` matching "${searchQuery}"` : ''}
            </Text>

            {/* Variables List */}
            {filteredVars.map(envVar => {
              const isExpanded = expandedKeys.has(envVar.key);
              const isLongValue = envVar.value.length > 60;

              return (
                <RNView
                  key={envVar.key}
                  style={[styles.envCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <RNView style={styles.envCardHeader}>
                    <Text style={[styles.envKey, { color: colors.text }]}>{envVar.key}</Text>
                    {isLongValue && (
                      <Pressable onPress={() => toggleExpanded(envVar.key)} style={styles.expandButton}>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.textSecondary}
                        />
                      </Pressable>
                    )}
                  </RNView>
                  <Text
                    style={[styles.envValue, { color: colors.textSecondary }]}
                    numberOfLines={isExpanded ? undefined : 2}
                  >
                    {envVar.value || '(empty)'}
                  </Text>
                </RNView>
              );
            })}

            {filteredVars.length === 0 && searchQuery && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No matching variables found.
              </Text>
            )}

            {vars.length === 0 && !searchQuery && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No environment variables found.
              </Text>
            )}
          </ScrollView>
        )}

        {/* Footer */}
        <RNView style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable
            style={[styles.footerButton, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.footerButtonText}>Close</Text>
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  countText: {
    fontSize: 12,
    marginBottom: 12,
  },
  envCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  envCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  envKey: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
    flex: 1,
  },
  expandButton: {
    padding: 4,
  },
  envValue: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    padding: 16,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  footerButton: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  footerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
