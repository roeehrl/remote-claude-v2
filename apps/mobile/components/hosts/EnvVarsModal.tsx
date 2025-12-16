import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  StyleSheet,
  Pressable,
  View as RNView,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { EnvVar } from '@remote-claude/shared-types';

interface EnvVarsModalProps {
  visible: boolean;
  hostId: string;
  hostName: string;
  systemVars: EnvVar[];
  customVars: EnvVar[];
  rcFile: string;
  detectedRcFile: string;
  loading?: boolean;
  onClose: () => void;
  onSave: (vars: EnvVar[]) => void;
  onChangeRcFile: (rcFile: string) => void;
}

export function EnvVarsModal({
  visible,
  hostId,
  hostName,
  systemVars,
  customVars,
  rcFile,
  detectedRcFile,
  loading,
  onClose,
  onSave,
  onChangeRcFile,
}: EnvVarsModalProps) {
  const colors = useThemeColors();
  const [editedVars, setEditedVars] = useState<EnvVar[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showRcFileInput, setShowRcFileInput] = useState(false);
  const [rcFileInput, setRcFileInput] = useState(rcFile);
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');

  // Initialize edited vars when modal opens or custom vars change
  useEffect(() => {
    setEditedVars([...customVars]);
  }, [customVars, visible]);

  useEffect(() => {
    setRcFileInput(rcFile);
  }, [rcFile]);

  const handleSave = useCallback(() => {
    onSave(editedVars);
  }, [editedVars, onSave]);

  const handleAddNew = useCallback(() => {
    if (!newKey.trim()) {
      Alert.alert('Error', 'Variable name is required');
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newKey)) {
      Alert.alert('Error', 'Invalid variable name. Must start with letter or underscore.');
      return;
    }
    if (editedVars.some(v => v.key === newKey)) {
      Alert.alert('Error', 'Variable already exists');
      return;
    }
    setEditedVars([...editedVars, { key: newKey, value: newValue }]);
    setNewKey('');
    setNewValue('');
    setAddingNew(false);
  }, [newKey, newValue, editedVars]);

  const handleDelete = useCallback((index: number) => {
    Alert.alert(
      'Delete Variable',
      `Are you sure you want to delete ${editedVars[index].key}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEditedVars(editedVars.filter((_, i) => i !== index));
          },
        },
      ]
    );
  }, [editedVars]);

  const handleStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditKey(editedVars[index].key);
    setEditValue(editedVars[index].value);
  }, [editedVars]);

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) return;
    if (!editKey.trim()) {
      Alert.alert('Error', 'Variable name is required');
      return;
    }
    const updated = [...editedVars];
    updated[editingIndex] = { key: editKey, value: editValue };
    setEditedVars(updated);
    setEditingIndex(null);
  }, [editingIndex, editKey, editValue, editedVars]);

  const handleRcFileSave = useCallback(() => {
    onChangeRcFile(rcFileInput);
    setShowRcFileInput(false);
  }, [rcFileInput, onChangeRcFile]);

  // Filter system vars by search
  const filteredSystemVars = systemVars.filter(v =>
    v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const hasChanges = JSON.stringify(editedVars) !== JSON.stringify(customVars);

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
            Environment Variables
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
              Loading environment variables...
            </Text>
          </RNView>
        ) : (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {/* RC File Section */}
            <RNView style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <RNView style={styles.rcFileRow}>
                <Text style={[styles.rcFileLabel, { color: colors.textSecondary }]}>RC File:</Text>
                {showRcFileInput ? (
                  <RNView style={styles.rcFileInputRow}>
                    <TextInput
                      style={[styles.rcFileInput, { color: colors.text, borderColor: colors.border }]}
                      value={rcFileInput}
                      onChangeText={setRcFileInput}
                      placeholder="~/.bashrc"
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable style={[styles.smallButton, { backgroundColor: colors.primary }]} onPress={handleRcFileSave}>
                      <Text style={styles.smallButtonText}>Save</Text>
                    </Pressable>
                    <Pressable style={[styles.smallButton, { backgroundColor: colors.error }]} onPress={() => setShowRcFileInput(false)}>
                      <Text style={styles.smallButtonText}>Cancel</Text>
                    </Pressable>
                  </RNView>
                ) : (
                  <RNView style={styles.rcFileDisplay}>
                    <Text style={[styles.rcFilePath, { color: colors.text }]}>{rcFile}</Text>
                    {rcFile !== detectedRcFile && (
                      <Text style={[styles.rcFileNote, { color: colors.warning }]}>(custom)</Text>
                    )}
                    <Pressable onPress={() => setShowRcFileInput(true)}>
                      <Text style={[styles.changeLink, { color: colors.primary }]}>Change</Text>
                    </Pressable>
                  </RNView>
                )}
              </RNView>
            </RNView>

            {/* Custom Variables Section */}
            <RNView style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>CUSTOM VARIABLES</Text>
              <Pressable
                style={[styles.addButton, { backgroundColor: colors.primary }]}
                onPress={() => setAddingNew(true)}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            </RNView>

            {/* Add New Variable Form */}
            {addingNew && (
              <RNView style={[styles.envCard, styles.editCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={newKey}
                  onChangeText={setNewKey}
                  placeholder="VARIABLE_NAME"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.input, styles.valueInput, { color: colors.text, borderColor: colors.border }]}
                  value={newValue}
                  onChangeText={setNewValue}
                  placeholder="value"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                />
                <RNView style={styles.editActions}>
                  <Pressable style={[styles.actionButton, { backgroundColor: colors.primary }]} onPress={handleAddNew}>
                    <Text style={styles.actionButtonText}>Add</Text>
                  </Pressable>
                  <Pressable style={[styles.actionButton, { backgroundColor: colors.error }]} onPress={() => setAddingNew(false)}>
                    <Text style={styles.actionButtonText}>Cancel</Text>
                  </Pressable>
                </RNView>
              </RNView>
            )}

            {/* Existing Custom Variables */}
            {editedVars.map((envVar, index) => (
              <RNView
                key={envVar.key}
                style={[
                  styles.envCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  editingIndex === index && { borderColor: colors.primary },
                ]}
              >
                {editingIndex === index ? (
                  <>
                    <TextInput
                      style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                      value={editKey}
                      onChangeText={setEditKey}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    <TextInput
                      style={[styles.input, styles.valueInput, { color: colors.text, borderColor: colors.border }]}
                      value={editValue}
                      onChangeText={setEditValue}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                    />
                    <RNView style={styles.editActions}>
                      <Pressable style={[styles.actionButton, { backgroundColor: colors.primary }]} onPress={handleSaveEdit}>
                        <Text style={styles.actionButtonText}>Save</Text>
                      </Pressable>
                      <Pressable style={[styles.actionButton, { backgroundColor: colors.error }]} onPress={() => setEditingIndex(null)}>
                        <Text style={styles.actionButtonText}>Cancel</Text>
                      </Pressable>
                    </RNView>
                  </>
                ) : (
                  <>
                    <RNView style={styles.envCardHeader}>
                      <Text style={[styles.envKey, { color: colors.text }]}>{envVar.key}</Text>
                      <RNView style={styles.envCardActions}>
                        <Pressable onPress={() => handleStartEdit(index)} style={styles.iconButton}>
                          <Ionicons name="pencil" size={16} color={colors.primary} />
                        </Pressable>
                        <Pressable onPress={() => handleDelete(index)} style={styles.iconButton}>
                          <Ionicons name="trash" size={16} color={colors.error} />
                        </Pressable>
                      </RNView>
                    </RNView>
                    <Text style={[styles.envValue, { color: colors.textSecondary }]} numberOfLines={2}>
                      {envVar.value || '(empty)'}
                    </Text>
                  </>
                )}
              </RNView>
            ))}

            {editedVars.length === 0 && !addingNew && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No custom variables defined. Tap "Add" to create one.
              </Text>
            )}

            {/* System Variables Section */}
            <RNView style={[styles.sectionHeader, { marginTop: 24 }]}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                SYSTEM VARIABLES (read-only)
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

            {/* System Variables List */}
            {filteredSystemVars.map(envVar => (
              <RNView
                key={envVar.key}
                style={[styles.envCard, styles.systemEnvCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.envKey, { color: colors.textSecondary }]}>{envVar.key}</Text>
                <Text style={[styles.envValue, { color: colors.textSecondary }]} numberOfLines={2}>
                  {envVar.value}
                </Text>
              </RNView>
            ))}

            {filteredSystemVars.length === 0 && searchQuery && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No matching variables found.
              </Text>
            )}
          </ScrollView>
        )}

        {/* Footer */}
        {!loading && (
          <RNView style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              style={[styles.footerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.footerButtonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.footerButton,
                { backgroundColor: hasChanges ? colors.primary : colors.card },
                !hasChanges && { borderColor: colors.border, borderWidth: 1 },
              ]}
              onPress={handleSave}
              disabled={!hasChanges}
            >
              <Text style={[styles.footerButtonText, { color: hasChanges ? '#fff' : colors.textSecondary }]}>
                Save Changes
              </Text>
            </Pressable>
          </RNView>
        )}
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
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  rcFileRow: {
    flexDirection: 'column',
  },
  rcFileLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  rcFileDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  rcFilePath: {
    fontSize: 14,
    fontFamily: 'SpaceMono',
  },
  rcFileNote: {
    fontSize: 12,
  },
  changeLink: {
    fontSize: 14,
    fontWeight: '500',
  },
  rcFileInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rcFileInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    fontSize: 14,
    fontFamily: 'SpaceMono',
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  envCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  editCard: {
    borderWidth: 2,
  },
  systemEnvCard: {
    opacity: 0.7,
  },
  envCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  envCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    padding: 4,
  },
  envKey: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  envValue: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    fontFamily: 'SpaceMono',
    marginBottom: 8,
  },
  valueInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
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
  },
  footerButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
