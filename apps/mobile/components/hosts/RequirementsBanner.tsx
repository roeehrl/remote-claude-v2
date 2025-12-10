import React from 'react';
import { StyleSheet, Pressable, View as RNView, ActivityIndicator, Linking } from 'react-native';
import { Text } from '@/components/Themed';
import { useThemeColors } from '@/providers/ThemeProvider';
import { HostRequirements } from '@remote-claude/shared-types';
import { Ionicons } from '@expo/vector-icons';

// GitHub repository URLs for requirements
const CLAUDE_CODE_URL = 'https://github.com/anthropics/claude-code';
const AGENTAPI_URL = 'https://github.com/coder/agentapi';

// ============================================================================
// Types
// ============================================================================

interface RequirementsBannerProps {
  hostId: string;
  requirements?: HostRequirements;
  isChecking?: boolean;
  onRefresh: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function RequirementsBanner({
  hostId,
  requirements,
  isChecking,
  onRefresh,
}: RequirementsBannerProps) {
  const colors = useThemeColors();

  // Don't show if everything is installed
  if (requirements?.claudeInstalled && requirements?.agentApiInstalled) {
    return null;
  }

  const missing: Array<{ name: string; url: string }> = [];
  if (!requirements?.claudeInstalled) {
    missing.push({ name: 'Claude Code', url: CLAUDE_CODE_URL });
  }
  if (!requirements?.agentApiInstalled) {
    missing.push({ name: 'AgentAPI', url: AGENTAPI_URL });
  }

  const handleOpenLink = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <RNView style={[styles.banner, {
      backgroundColor: colors.warning + '15',
      borderColor: colors.warning + '40',
    }]}>
      <RNView style={styles.iconContainer}>
        <Ionicons name="alert-circle" size={20} color={colors.warning} />
      </RNView>

      <RNView style={styles.content}>
        <Text style={[styles.title, { color: colors.warning }]}>
          Missing Requirements
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Install {missing.map(m => m.name).join(' and ')} on the remote host to enable Claude features.
        </Text>
        <RNView style={styles.links}>
          {missing.map((item, index) => (
            <Pressable
              key={index}
              style={({ pressed }) => [
                styles.linkButton,
                {
                  backgroundColor: colors.background,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={() => handleOpenLink(item.url)}
            >
              <Ionicons name="logo-github" size={14} color={colors.primary} />
              <Text style={[styles.linkText, { color: colors.primary }]}>
                {item.name}
              </Text>
              <Ionicons name="open-outline" size={12} color={colors.primary} />
            </Pressable>
          ))}
        </RNView>
      </RNView>

      <Pressable
        style={[styles.refreshBtn, {
          backgroundColor: isChecking ? colors.warning + '50' : colors.warning,
        }]}
        onPress={onRefresh}
        disabled={isChecking}
      >
        {isChecking ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="refresh" size={16} color="#fff" />
        )}
      </Pressable>
    </RNView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    gap: 10,
  },
  iconContainer: {
    paddingTop: 2,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  message: {
    fontSize: 13,
  },
  links: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 6,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '500',
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
