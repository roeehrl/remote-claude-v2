import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Text, Pressable, Platform, Alert, ActionSheetIOS } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';

import { useThemeColors } from '@/providers/ThemeProvider';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { Sidebar, SidebarItem, COLLAPSED_SIDEBAR_WIDTH } from '@/components/layout/Sidebar';
import { useBridge } from '@/providers/BridgeProvider';
import { useSettingsStore, selectHosts } from '@/stores';
import { Messages } from '@remote-claude/shared-types';

// ============================================================================
// Tab Bar Icon
// ============================================================================

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

// ============================================================================
// Sidebar Items
// ============================================================================

const SIDEBAR_ITEMS: SidebarItem[] = [
  { key: 'hosts', label: 'Hosts', icon: 'server-outline' },
  { key: 'chat', label: 'Chat', icon: 'chatbubble-outline' },
  { key: 'terminal', label: 'Terminal', icon: 'terminal-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

// Map route names to sidebar keys
function routeToKey(pathname: string): string {
  if (pathname.includes('/chat')) return 'chat';
  if (pathname.includes('/terminal')) return 'terminal';
  if (pathname.includes('/settings')) return 'settings';
  return 'hosts';
}

// ============================================================================
// New Shell Button (for Terminal header)
// ============================================================================

function NewShellButton() {
  const colors = useThemeColors();
  const { sendMessage, hosts: hostsMap } = useBridge();
  const hosts = useSettingsStore(selectHosts);

  // Get connected hosts
  const connectedHosts = useMemo(() => {
    const connected: Array<{ id: string; name: string }> = [];
    for (const [hostId, connectedHost] of hostsMap) {
      if (connectedHost.state === 'connected') {
        const hostConfig = hosts.find(h => h.id === hostId);
        connected.push({
          id: hostId,
          name: hostConfig?.name || hostId,
        });
      }
    }
    return connected;
  }, [hostsMap, hosts]);

  const handleNewShell = useCallback((hostId: string) => {
    sendMessage(Messages.processCreate({ hostId }));
  }, [sendMessage]);

  const handlePress = useCallback(() => {
    if (connectedHosts.length === 0) {
      if (Platform.OS === 'web') {
        alert('No connected hosts. Connect to a host first from the Hosts tab.');
      } else {
        Alert.alert('No Connected Hosts', 'Connect to a host first from the Hosts tab.');
      }
      return;
    }

    if (connectedHosts.length === 1) {
      // Only one host, create shell directly
      handleNewShell(connectedHosts[0].id);
      return;
    }

    // Multiple hosts - show picker
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', ...connectedHosts.map(h => h.name)],
          cancelButtonIndex: 0,
          title: 'Create new shell on:',
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            handleNewShell(connectedHosts[buttonIndex - 1].id);
          }
        }
      );
    } else if (Platform.OS === 'web') {
      // Simple prompt for web
      const hostNames = connectedHosts.map((h, i) => `${i + 1}. ${h.name}`).join('\n');
      const choice = prompt(`Create new shell on:\n${hostNames}\n\nEnter number (1-${connectedHosts.length}):`);
      if (choice) {
        const index = parseInt(choice, 10) - 1;
        if (index >= 0 && index < connectedHosts.length) {
          handleNewShell(connectedHosts[index].id);
        }
      }
    } else {
      // Android - use Alert with buttons
      Alert.alert(
        'Create New Shell',
        'Select a host:',
        [
          { text: 'Cancel', style: 'cancel' },
          ...connectedHosts.map(h => ({
            text: h.name,
            onPress: () => handleNewShell(h.id),
          })),
        ]
      );
    }
  }, [connectedHosts, handleNewShell]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.headerButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="add" size={24} color={colors.primary} />
    </Pressable>
  );
}

// ============================================================================
// Tab Layout
// ============================================================================

export default function TabLayout() {
  const colors = useThemeColors();
  const layout = useResponsiveLayout();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Hide the default tab bar on larger screens (we use Sidebar instead)
  const showTabBar = layout.showBottomTabs;
  const showSidebar = layout.showSidebar;

  // Toggle sidebar collapse
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  // Current active tab based on route
  const activeKey = routeToKey(pathname);

  // Handle tab change from sidebar
  const handleSelect = (key: string) => {
    switch (key) {
      case 'hosts':
        router.push('/');
        break;
      case 'chat':
        router.push('/chat');
        break;
      case 'terminal':
        router.push('/terminal');
        break;
      case 'settings':
        router.push('/settings');
        break;
    }
  };

  const tabsContent = (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: showTabBar
          ? {
              backgroundColor: colors.navBackground,
              borderTopColor: colors.border,
            }
          : { display: 'none' },
        headerStyle: {
          backgroundColor: colors.navBackground,
        },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerShown: useClientOnlyValue(false, true),
        sceneStyle: {
          backgroundColor: colors.background,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hosts',
          tabBarIcon: ({ color }) => <TabBarIcon name="server" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color }) => <TabBarIcon name="terminal" color={color} />,
          headerRight: () => <NewShellButton />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
        }}
      />
    </Tabs>
  );

  // On desktop/tablet, wrap with sidebar
  if (showSidebar) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Sidebar
          items={SIDEBAR_ITEMS}
          selectedKey={activeKey}
          onSelect={handleSelect}
          width={layout.sidebarWidth}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          header={
            <Text style={[styles.sidebarHeader, { color: colors.text }]}>
              Remote Claude
            </Text>
          }
        />
        <View style={styles.content}>{tabsContent}</View>
      </View>
    );
  }

  // On mobile, just render tabs
  return tabsContent;
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
  },
  sidebarHeader: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
