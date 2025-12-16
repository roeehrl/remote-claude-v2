import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Text, Pressable, Platform, Alert, ActionSheetIOS, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';

import { useThemeColors } from '@/providers/ThemeProvider';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { Sidebar, SidebarItem, COLLAPSED_SIDEBAR_WIDTH } from '@/components/layout/Sidebar';
import { useBridge } from '@/providers/BridgeProvider';
import { Messages, ProcessInfo } from '@remote-claude/shared-types';

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
  const { sendMessage, hosts: hostsMap, configuredHosts } = useBridge();

  // Get connected hosts
  const connectedHosts = useMemo(() => {
    const connected: Array<{ id: string; name: string }> = [];
    for (const [hostId, connectedHost] of hostsMap) {
      if (connectedHost.state === 'connected') {
        const hostConfig = configuredHosts.find(h => h.id === hostId);
        connected.push({
          id: hostId,
          name: hostConfig?.name || hostId,
        });
      }
    }
    return connected;
  }, [hostsMap, configuredHosts]);

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
// Custom Header (for native - gives us full layout control)
// ============================================================================

interface CustomHeaderProps {
  title: string;
  renderProcessChips?: () => React.ReactNode;
  renderRight?: () => React.ReactNode;
}

function CustomHeader({ title, renderProcessChips, renderRight }: CustomHeaderProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      styles.customHeader,
      {
        backgroundColor: colors.navBackground,
        paddingTop: insets.top,
        borderBottomColor: colors.border,
      }
    ]}>
      <View style={styles.customHeaderContent}>
        <Text style={[styles.customHeaderTitle, { color: colors.text }]}>{title}</Text>
        {renderProcessChips && (
          <View style={styles.customHeaderChips}>
            {renderProcessChips()}
          </View>
        )}
        {renderRight && (
          <View style={styles.customHeaderRight}>
            {renderRight()}
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// Process Chips Components (shared rendering logic)
// ============================================================================

function ProcessChip({
  proc,
  isSelected,
  onPress,
  onLongPress,
  showPort = false,
}: {
  proc: ProcessInfo;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  showPort?: boolean;
}) {
  const colors = useThemeColors();
  const displayName = proc.name || proc.cwd.split('/').pop() || 'shell';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.processChip,
        {
          backgroundColor: isSelected ? colors.primary : colors.backgroundTertiary,
          opacity: pressed ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    >
      <Ionicons
        name={proc.type === 'claude' ? 'chatbubble-ellipses' : 'terminal'}
        size={10}
        color={isSelected ? '#fff' : colors.textSecondary}
      />
      <View style={styles.processChipContent}>
        <Text style={[styles.processChipText, { color: isSelected ? '#fff' : colors.text }]}>
          {displayName}
        </Text>
        <Text style={[styles.processChipPid, { color: isSelected ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
          PID: {proc.shellPid || '—'}{showPort && proc.port ? ` | Port: ${proc.port}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function TerminalProcessChips() {
  const { hosts: hostsMap, selectedProcessId, selectProcess, sendMessage } = useBridge();

  const allProcesses = useMemo(() => {
    const processes: ProcessInfo[] = [];
    for (const host of hostsMap.values()) {
      if (host.processes) {
        processes.push(...host.processes);
      }
    }
    return processes;
  }, [hostsMap]);

  const handleRenameProcess = useCallback((proc: ProcessInfo) => {
    const currentName = proc.name || proc.cwd.split('/').pop() || 'shell';
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Rename Process',
        'Enter a new name for this process:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (newName: string | undefined) => {
              if (newName && newName !== currentName) {
                sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
              }
            },
          },
        ],
        'plain-text',
        currentName
      );
    } else {
      Alert.alert(
        'Rename Process',
        `Current name: ${currentName}\n\nTo rename, please use iOS or web.`,
        [{ text: 'OK' }]
      );
    }
  }, [sendMessage]);

  if (allProcesses.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.processChipsContainer}
    >
      {allProcesses.map(proc => (
        <ProcessChip
          key={proc.id}
          proc={proc}
          isSelected={selectedProcessId === proc.id}
          onPress={() => selectProcess(proc.id)}
          onLongPress={() => handleRenameProcess(proc)}
        />
      ))}
    </ScrollView>
  );
}

function ChatProcessChips() {
  const { hosts: hostsMap, selectedProcessId, selectProcess, sendMessage } = useBridge();

  const claudeProcesses = useMemo(() => {
    const processes: ProcessInfo[] = [];
    for (const host of hostsMap.values()) {
      if (host.processes) {
        processes.push(...host.processes.filter(p => p.type === 'claude'));
      }
    }
    return processes;
  }, [hostsMap]);

  const handleRenameProcess = useCallback((proc: ProcessInfo) => {
    const currentName = proc.name || proc.cwd.split('/').pop() || 'claude';
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Rename Chat',
        'Enter a new name for this chat:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (newName: string | undefined) => {
              if (newName && newName !== currentName) {
                sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
              }
            },
          },
        ],
        'plain-text',
        currentName
      );
    } else {
      Alert.alert(
        'Rename Chat',
        `Current name: ${currentName}\n\nTo rename, please use iOS or web.`,
        [{ text: 'OK' }]
      );
    }
  }, [sendMessage]);

  if (claudeProcesses.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.processChipsContainer}
    >
      {claudeProcesses.map(proc => (
        <ProcessChip
          key={proc.id}
          proc={proc}
          isSelected={selectedProcessId === proc.id}
          onPress={() => selectProcess(proc.id)}
          onLongPress={() => handleRenameProcess(proc)}
          showPort
        />
      ))}
    </ScrollView>
  );
}

// ============================================================================
// Terminal Header Title (with process selector) - for web
// ============================================================================

function TerminalHeaderTitle() {
  const colors = useThemeColors();
  const { hosts: hostsMap, selectedProcessId, selectProcess, sendMessage } = useBridge();

  // Get all processes from connected hosts
  const allProcesses = useMemo(() => {
    const processes: ProcessInfo[] = [];
    for (const host of hostsMap.values()) {
      if (host.processes) {
        processes.push(...host.processes);
      }
    }
    return processes;
  }, [hostsMap]);

  const selectedProcess = useMemo(() => {
    if (!selectedProcessId) return undefined;
    return allProcesses.find(p => p.id === selectedProcessId);
  }, [allProcesses, selectedProcessId]);

  const handleRenameProcess = useCallback((proc: ProcessInfo) => {
    const currentName = proc.name || proc.cwd.split('/').pop() || 'shell';
    if (Platform.OS === 'web') {
      const newName = prompt('Rename process:', currentName);
      if (newName !== null && newName !== currentName) {
        sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
      }
    } else if (Platform.OS === 'ios') {
      Alert.prompt(
        'Rename Process',
        'Enter a new name for this process:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (newName: string | undefined) => {
              if (newName && newName !== currentName) {
                sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
              }
            },
          },
        ],
        'plain-text',
        currentName
      );
    } else {
      // Android - Alert.prompt not available, use a simple alert with predefined options
      // or you could implement a custom modal
      Alert.alert(
        'Rename Process',
        `Current name: ${currentName}\n\nTo rename, please use the web interface or iOS app.`,
        [{ text: 'OK' }]
      );
    }
  }, [sendMessage]);

  return (
    <View style={styles.headerTitleContainer}>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Terminal</Text>
      {allProcesses.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.processChipsContainer}
          style={styles.processChipsScroll}
        >
          {allProcesses.map(proc => {
            const isSelected = selectedProcess?.id === proc.id;
            const displayName = proc.name || proc.cwd.split('/').pop() || 'shell';
            return (
              <Pressable
                key={proc.id}
                style={({ pressed }) => [
                  styles.processChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.backgroundTertiary,
                    opacity: pressed ? 0.5 : 1,
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                  },
                ]}
                onPress={() => selectProcess(proc.id)}
                onLongPress={() => handleRenameProcess(proc)}
                delayLongPress={500}
              >
                <Ionicons
                  name={proc.type === 'claude' ? 'chatbubble-ellipses' : 'terminal'}
                  size={10}
                  color={isSelected ? '#fff' : colors.textSecondary}
                />
                <View style={styles.processChipContent}>
                  <Text
                    style={[
                      styles.processChipText,
                      { color: isSelected ? '#fff' : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                  <Text
                    style={[
                      styles.processChipPid,
                      { color: isSelected ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    PID: {proc.shellPid || '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ============================================================================
// Chat Header Title (with process selector for Claude processes)
// ============================================================================

function ChatHeaderTitle() {
  const colors = useThemeColors();
  const { hosts: hostsMap, selectedProcessId, selectProcess, sendMessage } = useBridge();

  // Get Claude processes from connected hosts
  const claudeProcesses = useMemo(() => {
    const processes: ProcessInfo[] = [];
    for (const host of hostsMap.values()) {
      if (host.processes) {
        processes.push(...host.processes.filter(p => p.type === 'claude'));
      }
    }
    return processes;
  }, [hostsMap]);

  const selectedProcess = useMemo(() => {
    if (!selectedProcessId) return undefined;
    return claudeProcesses.find(p => p.id === selectedProcessId);
  }, [claudeProcesses, selectedProcessId]);

  const handleRenameProcess = useCallback((proc: ProcessInfo) => {
    const currentName = proc.name || proc.cwd.split('/').pop() || 'claude';
    if (Platform.OS === 'web') {
      const newName = prompt('Rename chat:', currentName);
      if (newName !== null && newName !== currentName) {
        sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
      }
    } else if (Platform.OS === 'ios') {
      Alert.prompt(
        'Rename Chat',
        'Enter a new name for this chat:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (newName: string | undefined) => {
              if (newName && newName !== currentName) {
                sendMessage(Messages.processRename({ processId: proc.id, name: newName }));
              }
            },
          },
        ],
        'plain-text',
        currentName
      );
    } else {
      // Android - Alert.prompt not available
      Alert.alert(
        'Rename Chat',
        `Current name: ${currentName}\n\nTo rename, please use the web interface or iOS app.`,
        [{ text: 'OK' }]
      );
    }
  }, [sendMessage]);

  return (
    <View style={styles.headerTitleContainer}>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Chat</Text>
      {claudeProcesses.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.processChipsContainer}
          style={styles.processChipsScroll}
        >
          {claudeProcesses.map(proc => {
            const isSelected = selectedProcess?.id === proc.id;
            const displayName = proc.name || proc.cwd.split('/').pop() || 'claude';
            return (
              <Pressable
                key={proc.id}
                style={({ pressed }) => [
                  styles.processChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.backgroundTertiary,
                    opacity: pressed ? 0.5 : 1,
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                  },
                ]}
                onPress={() => selectProcess(proc.id)}
                onLongPress={() => handleRenameProcess(proc)}
                delayLongPress={500}
              >
                <Ionicons
                  name="chatbubble-ellipses"
                  size={10}
                  color={isSelected ? '#fff' : colors.textSecondary}
                />
                <View style={styles.processChipContent}>
                  <Text
                    style={[
                      styles.processChipText,
                      { color: isSelected ? '#fff' : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                  <Text
                    style={[
                      styles.processChipPid,
                      { color: isSelected ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    PID: {proc.shellPid || '—'} | Port: {proc.port || '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
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
        // Left-align header title on native (web already left-aligns)
        headerTitleAlign: 'left',
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
          // Use custom header on native for full layout control
          ...(Platform.OS !== 'web' ? {
            header: () => <CustomHeader title="Chat" renderProcessChips={() => <ChatProcessChips />} />,
          } : {
            headerTitle: () => <ChatHeaderTitle />,
          }),
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color }) => <TabBarIcon name="terminal" color={color} />,
          // Use custom header on native for full layout control
          ...(Platform.OS !== 'web' ? {
            header: () => <CustomHeader title="Terminal" renderProcessChips={() => <TerminalProcessChips />} renderRight={() => <NewShellButton />} />,
          } : {
            headerTitle: () => <TerminalHeaderTitle />,
            headerRight: () => <NewShellButton />,
          }),
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
  // Custom header styles (native only)
  customHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 16,
    gap: 12,
  },
  customHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    flexShrink: 0,
  },
  customHeaderChips: {
    flex: 1,
    overflow: 'hidden',
  },
  customHeaderRight: {
    flexShrink: 0,
  },
  // Standard header styles (web)
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    flexShrink: 0,
  },
  processChipsScroll: {
    flex: 1,
  },
  processChipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  processChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    // No maxWidth - let content determine width naturally
    // Chip will be as wide as needed to fit text without truncation
  },
  processChipContent: {
    flexDirection: 'column',
    // No flex: 1 - let text content determine width
  },
  processChipText: {
    fontSize: 11,
    fontWeight: '500',
    // Don't wrap or shrink
    flexShrink: 0,
  },
  processChipPid: {
    fontSize: 9,
    fontWeight: '400',
    // Don't wrap or shrink
    flexShrink: 0,
  },
});
