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
import { Snippet } from '@remote-claude/shared-types';

export type SnippetsModalMode = 'select' | 'edit';

interface SnippetsModalProps {
  visible: boolean;
  mode: SnippetsModalMode;
  snippets: Snippet[];
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSelect?: (snippet: Snippet) => void;
  onSave?: (snippets: Snippet[]) => void;
  onCreateSnippet?: (name: string, content: string) => void;
  onUpdateSnippet?: (id: string, name: string, content: string) => void;
  onDeleteSnippet?: (id: string) => void;
}

export function SnippetsModal({
  visible,
  mode,
  snippets,
  loading,
  error,
  onClose,
  onSelect,
  onCreateSnippet,
  onUpdateSnippet,
  onDeleteSnippet,
}: SnippetsModalProps) {
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setAddingNew(false);
      setNewName('');
      setNewContent('');
      setEditingId(null);
    }
  }, [visible]);

  // Filter snippets by search
  const filteredSnippets = snippets.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddNew = useCallback(() => {
    if (!newName.trim()) {
      Alert.alert('Error', 'Snippet name is required');
      return;
    }
    onCreateSnippet?.(newName.trim(), newContent);
    setNewName('');
    setNewContent('');
    setAddingNew(false);
  }, [newName, newContent, onCreateSnippet]);

  const handleStartEdit = useCallback((snippet: Snippet) => {
    setEditingId(snippet.id);
    setEditName(snippet.name);
    setEditContent(snippet.content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    if (!editName.trim()) {
      Alert.alert('Error', 'Snippet name is required');
      return;
    }
    onUpdateSnippet?.(editingId, editName.trim(), editContent);
    setEditingId(null);
  }, [editingId, editName, editContent, onUpdateSnippet]);

  const handleDelete = useCallback((snippet: Snippet) => {
    Alert.alert(
      'Delete Snippet',
      `Are you sure you want to delete "${snippet.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteSnippet?.(snippet.id),
        },
      ]
    );
  }, [onDeleteSnippet]);

  const handleSnippetPress = useCallback((snippet: Snippet) => {
    if (mode === 'select') {
      onSelect?.(snippet);
      onClose();
    } else {
      handleStartEdit(snippet);
    }
  }, [mode, onSelect, onClose, handleStartEdit]);

  const isEditMode = mode === 'edit';
  const title = isEditMode ? 'Manage Snippets' : 'Select Snippet';
  const subtitle = isEditMode ? 'Create, edit, or delete command snippets' : 'Tap a snippet to type it into the terminal';

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
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </RNView>

        {loading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading snippets...
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
            {/* Info Banner (only in select mode) */}
            {!isEditMode && (
              <RNView style={[styles.infoBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
                <Ionicons name="information-circle" size={18} color={colors.primary} />
                <Text style={[styles.infoText, { color: colors.primary }]}>
                  Tap a snippet to type it into the terminal. Manage snippets in Settings.
                </Text>
              </RNView>
            )}

            {/* Add Button (only in edit mode) */}
            {isEditMode && (
              <RNView style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>SNIPPETS</Text>
                <Pressable
                  style={[styles.addButton, { backgroundColor: colors.primary }]}
                  onPress={() => setAddingNew(true)}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addButtonText}>Add</Text>
                </Pressable>
              </RNView>
            )}

            {/* Add New Snippet Form (only in edit mode) */}
            {isEditMode && addingNew && (
              <RNView style={[styles.snippetCard, styles.editCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Snippet name"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.input, styles.contentInput, { color: colors.text, borderColor: colors.border }]}
                  value={newContent}
                  onChangeText={setNewContent}
                  placeholder="Command content"
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

            {/* Search */}
            <RNView style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search snippets..."
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
              {filteredSnippets.length} snippet{filteredSnippets.length !== 1 ? 's' : ''}
              {searchQuery ? ` matching "${searchQuery}"` : ''}
            </Text>

            {/* Snippets List */}
            {filteredSnippets.map(snippet => {
              const isEditing = editingId === snippet.id;

              return (
                <RNView
                  key={snippet.id}
                  style={[
                    styles.snippetCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    isEditing && { borderColor: colors.primary },
                  ]}
                >
                  {isEditing ? (
                    <>
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                        value={editName}
                        onChangeText={setEditName}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TextInput
                        style={[styles.input, styles.contentInput, { color: colors.text, borderColor: colors.border }]}
                        value={editContent}
                        onChangeText={setEditContent}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline
                      />
                      <RNView style={styles.editActions}>
                        <Pressable style={[styles.actionButton, { backgroundColor: colors.primary }]} onPress={handleSaveEdit}>
                          <Text style={styles.actionButtonText}>Save</Text>
                        </Pressable>
                        <Pressable style={[styles.actionButton, { backgroundColor: colors.error }]} onPress={() => setEditingId(null)}>
                          <Text style={styles.actionButtonText}>Cancel</Text>
                        </Pressable>
                      </RNView>
                    </>
                  ) : (
                    <Pressable onPress={() => handleSnippetPress(snippet)}>
                      <RNView style={styles.snippetCardHeader}>
                        <Text style={[styles.snippetName, { color: colors.text }]}>{snippet.name}</Text>
                        {isEditMode && (
                          <RNView style={styles.snippetCardActions}>
                            <Pressable onPress={() => handleStartEdit(snippet)} style={styles.iconButton}>
                              <Ionicons name="pencil" size={16} color={colors.primary} />
                            </Pressable>
                            <Pressable onPress={() => handleDelete(snippet)} style={styles.iconButton}>
                              <Ionicons name="trash" size={16} color={colors.error} />
                            </Pressable>
                          </RNView>
                        )}
                        {!isEditMode && (
                          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                        )}
                      </RNView>
                      <Text
                        style={[styles.snippetContent, { color: colors.textSecondary }]}
                        numberOfLines={2}
                      >
                        {snippet.content || '(empty)'}
                      </Text>
                    </Pressable>
                  )}
                </RNView>
              );
            })}

            {filteredSnippets.length === 0 && searchQuery && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No matching snippets found.
              </Text>
            )}

            {snippets.length === 0 && !searchQuery && (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {isEditMode
                  ? 'No snippets defined. Tap "Add" to create one.'
                  : 'No snippets available. Create snippets in Settings.'}
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
    textAlign: 'center',
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
  snippetCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  editCard: {
    borderWidth: 2,
  },
  snippetCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  snippetCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    padding: 4,
  },
  snippetName: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  snippetContent: {
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  contentInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    fontFamily: 'SpaceMono',
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
