import React from 'react';
import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';

// ============================================================================
// Constants
// ============================================================================

export const COLLAPSED_SIDEBAR_WIDTH = 64;

// ============================================================================
// Types
// ============================================================================

export interface SidebarItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
}

interface SidebarProps {
  items: SidebarItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  width: number;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function Sidebar({
  items,
  selectedKey,
  onSelect,
  width,
  header,
  footer,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const colors = useThemeColors();
  const actualWidth = isCollapsed ? COLLAPSED_SIDEBAR_WIDTH : width;

  return (
    <View style={[styles.container, { width: actualWidth, backgroundColor: colors.backgroundSecondary, borderRightColor: colors.border }]}>
      {/* Header with collapse toggle */}
      <View style={[styles.header, isCollapsed && styles.headerCollapsed]}>
        {!isCollapsed && header}
        {onToggleCollapse && (
          <Pressable
            style={({ pressed }) => [
              styles.collapseButton,
              { opacity: pressed ? 0.7 : 1 },
              isCollapsed && styles.collapseButtonCollapsed,
            ]}
            onPress={onToggleCollapse}
          >
            <Ionicons
              name={isCollapsed ? 'chevron-forward' : 'chevron-back'}
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {items.map((item) => {
          const isSelected = item.key === selectedKey;

          return (
            <Pressable
              key={item.key}
              style={[
                styles.item,
                isCollapsed && styles.itemCollapsed,
                isSelected && { backgroundColor: colors.primary + '20' },
              ]}
              onPress={() => onSelect(item.key)}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={isSelected ? colors.primary : colors.textSecondary}
              />
              {!isCollapsed && (
                <Text
                  style={[
                    styles.itemLabel,
                    { color: isSelected ? colors.primary : colors.text },
                  ]}
                >
                  {item.label}
                </Text>
              )}
              {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </Text>
                </View>
              )}
              {/* Show badge dot when collapsed */}
              {isCollapsed && item.badge !== undefined && item.badge > 0 && (
                <View style={[styles.badgeDot, { backgroundColor: colors.primary }]} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {footer && !isCollapsed && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    borderRightWidth: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCollapsed: {
    justifyContent: 'center',
    padding: 12,
  },
  collapseButton: {
    padding: 4,
    borderRadius: 4,
  },
  collapseButtonCollapsed: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 4,
    gap: 12,
  },
  itemCollapsed: {
    justifyContent: 'center',
    padding: 12,
    gap: 0,
  },
  itemLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  badgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
});
