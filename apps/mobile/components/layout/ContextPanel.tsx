import React from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Types
// ============================================================================

interface ContextPanelProps {
  width: number;
  title?: string;
  onClose?: () => void;
  children?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

export function ContextPanel({
  width,
  title,
  onClose,
  children,
}: ContextPanelProps) {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { width, backgroundColor: colors.backgroundSecondary, borderLeftColor: colors.border }]}>
      {(title || onClose) && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {title && (
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          )}
          {onClose && (
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {children}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
});
