import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  View,
  Switch,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Lazy import for document picker to handle missing native module gracefully
let DocumentPicker: typeof import('expo-document-picker') | null = null;
let FileSystem: typeof import('expo-file-system') | null = null;

try {
  DocumentPicker = require('expo-document-picker');
  FileSystem = require('expo-file-system');
} catch {
  // Native modules not available - file picker will be disabled
}

import { Text } from '@/components/Themed';
import { useTheme, useThemeColors } from '@/providers';
import { useSettingsStore, SSHHost, storeHostCredential } from '@/stores/settingsStore';

// ============================================================================
// Section Header Component
// ============================================================================

function SectionHeader({ title }: { title: string }) {
  const colors = useThemeColors();
  return (
    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
      {title}
    </Text>
  );
}

// ============================================================================
// Settings Row Component
// ============================================================================

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  isDestructive?: boolean;
}

function SettingsRow({ label, value, onPress, rightElement, isDestructive }: SettingsRowProps) {
  const colors = useThemeColors();

  const content = (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: isDestructive ? colors.error : colors.text }]}>
        {label}
      </Text>
      {value && (
        <Text style={[styles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

// ============================================================================
// Host Row Component
// ============================================================================

interface HostRowProps {
  host: SSHHost;
  onEdit: () => void;
  onDelete: () => void;
}

function HostRow({ host, onEdit, onDelete }: HostRowProps) {
  const colors = useThemeColors();

  const handleDelete = () => {
    Alert.alert(
      'Delete Host',
      `Are you sure you want to delete "${host.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  return (
    <View style={[styles.hostRow, { borderBottomColor: colors.border }]}>
      <TouchableOpacity style={styles.hostInfo} onPress={onEdit} activeOpacity={0.7}>
        <Text style={styles.hostName}>{host.name}</Text>
        <Text style={[styles.hostDetails, { color: colors.textSecondary }]}>
          {host.username}@{host.host}:{host.port}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={{ color: colors.error, fontSize: 18 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================================================
// Add/Edit Host Modal (inline for now)
// ============================================================================

interface HostFormProps {
  host?: SSHHost;
  onSave: (host: Omit<SSHHost, 'id'>, credential: string) => void;
  onCancel: () => void;
}

function HostForm({ host, onSave, onCancel }: HostFormProps) {
  const colors = useThemeColors();
  const [name, setName] = useState(host?.name ?? '');
  const [hostAddress, setHostAddress] = useState(host?.host ?? '');
  const [port, setPort] = useState(host?.port?.toString() ?? '22');
  const [username, setUsername] = useState(host?.username ?? '');
  const [authType, setAuthType] = useState<'password' | 'key'>(host?.authType ?? 'password');
  const [autoConnect, setAutoConnect] = useState(host?.autoConnect ?? false);
  const [credential, setCredential] = useState('');

  const handleSave = () => {
    if (!name.trim() || !hostAddress.trim() || !username.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    if (!host && !credential.trim()) {
      Alert.alert('Error', 'Please enter a password or private key');
      return;
    }

    onSave(
      {
        name: name.trim(),
        host: hostAddress.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authType,
        autoConnect,
      },
      credential
    );
  };

  return (
    <View style={[styles.form, { backgroundColor: colors.card }]}>
      <Text style={styles.formTitle}>{host ? 'Edit Host' : 'Add Host'}</Text>

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Name *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
        value={name}
        onChangeText={setName}
        placeholder="My Server"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Host *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
        value={hostAddress}
        onChangeText={setHostAddress}
        placeholder="192.168.1.100 or hostname.local"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Port</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
        value={port}
        onChangeText={setPort}
        placeholder="22"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
      />

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Username *</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
        value={username}
        onChangeText={setUsername}
        placeholder="ubuntu"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Auth Type</Text>
      <View style={styles.authTypeRow}>
        <TouchableOpacity
          style={[
            styles.authTypeButton,
            { borderColor: colors.border },
            authType === 'password' && { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          onPress={() => setAuthType('password')}
        >
          <Text style={[styles.authTypeText, authType === 'password' && { color: '#fff' }]}>
            Password
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.authTypeButton,
            { borderColor: colors.border },
            authType === 'key' && { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          onPress={() => setAuthType('key')}
        >
          <Text style={[styles.authTypeText, authType === 'key' && { color: '#fff' }]}>
            Private Key
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.autoConnectRow}>
        <View style={styles.autoConnectLabel}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 0, marginBottom: 0 }]}>
            Auto-connect
          </Text>
          <Text style={[styles.helperText, { color: colors.textMuted, marginBottom: 0 }]}>
            Reconnect automatically on page reload (web)
          </Text>
        </View>
        <Switch
          value={autoConnect}
          onValueChange={setAutoConnect}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={Platform.OS === 'android' ? (autoConnect ? colors.primary : '#f4f3f4') : undefined}
        />
      </View>

      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
        {authType === 'password' ? 'Password' : 'Private Key'} {host ? '(leave empty to keep)' : '*'}
      </Text>
      {authType === 'key' && (
        <Text style={[styles.helperText, { color: colors.textMuted }]}>
          OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----)
        </Text>
      )}
      {authType === 'password' ? (
        <TextInput
          style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
          value={credential}
          onChangeText={setCredential}
          placeholder="Enter password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : (
        <View>
          {DocumentPicker && FileSystem && (
            <View style={styles.keyInputHeader}>
              <TouchableOpacity
                style={[styles.filePickerButton, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
                onPress={async () => {
                  try {
                    const result = await DocumentPicker.getDocumentAsync({
                      type: '*/*',
                      copyToCacheDirectory: true,
                    });
                    if (!result.canceled && result.assets[0]) {
                      const fileUri = result.assets[0].uri;
                      const content = await FileSystem.readAsStringAsync(fileUri);
                      setCredential(content);
                    }
                  } catch (error) {
                    Alert.alert('Error', 'Failed to read file');
                  }
                }}
              >
                <Text style={{ color: colors.text, fontSize: 14 }}>Browse File...</Text>
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={[
              styles.input,
              styles.privateKeyInput,
              { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border },
            ]}
            value={credential}
            onChangeText={setCredential}
            placeholder="Paste private key or use Browse File above"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
          />
        </View>
      )}

      <View style={styles.formButtons}>
        <TouchableOpacity
          style={[styles.formButton, { backgroundColor: colors.backgroundTertiary }]}
          onPress={onCancel}
        >
          <Text style={{ color: colors.text }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.formButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
        >
          <Text style={{ color: '#fff' }}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ============================================================================
// Main Settings Screen
// ============================================================================

export default function SettingsScreen() {
  const colors = useThemeColors();
  const { themeMode, setThemeMode } = useTheme();
  const {
    bridgeUrl,
    setBridgeUrl,
    hosts,
    addHost,
    updateHost,
    removeHost,
    fontSize,
    setFontSize,
  } = useSettingsStore();

  const [editingHost, setEditingHost] = useState<SSHHost | null>(null);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [editingBridgeUrl, setEditingBridgeUrl] = useState(false);
  const [tempBridgeUrl, setTempBridgeUrl] = useState(bridgeUrl);

  const handleSaveHost = useCallback(async (hostData: Omit<SSHHost, 'id'>, credential: string) => {
    try {
      if (editingHost) {
        // Update existing host
        updateHost(editingHost.id, hostData);
        if (credential) {
          await storeHostCredential(editingHost.id, credential);
        }
      } else {
        // Add new host
        const id = addHost(hostData);
        await storeHostCredential(id, credential);
      }
      setEditingHost(null);
      setIsAddingHost(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to save host');
    }
  }, [editingHost, addHost, updateHost]);

  const handleSaveBridgeUrl = () => {
    if (tempBridgeUrl.trim()) {
      setBridgeUrl(tempBridgeUrl.trim());
    }
    setEditingBridgeUrl(false);
  };

  const themeModeLabel = themeMode === 'system' ? 'System' : themeMode === 'dark' ? 'Dark' : 'Light';

  const handleThemeChange = () => {
    const modes: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
    const currentIndex = modes.indexOf(themeMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setThemeMode(modes[nextIndex]);
  };

  // Show host form if adding or editing
  if (isAddingHost || editingHost) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
            <HostForm
              host={editingHost ?? undefined}
              onSave={handleSaveHost}
              onCancel={() => {
                setEditingHost(null);
                setIsAddingHost(false);
              }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView style={styles.scrollView}>
        {/* Bridge Connection Section */}
        <SectionHeader title="BRIDGE CONNECTION" />
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          {editingBridgeUrl ? (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <TextInput
                style={[styles.urlInput, { color: colors.text }]}
                value={tempBridgeUrl}
                onChangeText={setTempBridgeUrl}
                placeholder="ws://localhost:8080/ws"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onBlur={handleSaveBridgeUrl}
                onSubmitEditing={handleSaveBridgeUrl}
              />
            </View>
          ) : (
            <SettingsRow
              label="WebSocket URL"
              value={bridgeUrl}
              onPress={() => {
                setTempBridgeUrl(bridgeUrl);
                setEditingBridgeUrl(true);
              }}
            />
          )}
        </View>

        {/* SSH Hosts Section */}
        <SectionHeader title="SSH HOSTS" />
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          {hosts.map((host) => (
            <HostRow
              key={host.id}
              host={host}
              onEdit={() => setEditingHost(host)}
              onDelete={() => removeHost(host.id)}
            />
          ))}
          <SettingsRow
            label="+ Add Host"
            onPress={() => setIsAddingHost(true)}
          />
        </View>

        {/* Appearance Section */}
        <SectionHeader title="APPEARANCE" />
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <SettingsRow
            label="Theme"
            value={themeModeLabel}
            onPress={handleThemeChange}
          />
          <SettingsRow
            label="Terminal Font Size"
            rightElement={
              <View style={styles.fontSizeControls}>
                <TouchableOpacity
                  style={[styles.fontSizeButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => setFontSize(fontSize - 1)}
                >
                  <Text style={{ fontSize: 18, color: colors.text }}>−</Text>
                </TouchableOpacity>
                <Text style={[styles.fontSizeValue, { color: colors.text }]}>{fontSize}</Text>
                <TouchableOpacity
                  style={[styles.fontSizeButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => setFontSize(fontSize + 1)}
                >
                  <Text style={{ fontSize: 18, color: colors.text }}>+</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </View>

        {/* About Section */}
        <SectionHeader title="ABOUT" />
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <SettingsRow label="Version" value="0.1.0" />
          <SettingsRow label="Remote Claude V2" value="Beta" />
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 16,
    letterSpacing: 0.5,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 16,
  },
  rowValue: {
    fontSize: 16,
    maxWidth: '50%',
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hostInfo: {
    flex: 1,
  },
  hostName: {
    fontSize: 16,
    fontWeight: '500',
  },
  hostDetails: {
    fontSize: 14,
    marginTop: 2,
  },
  urlInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  fontSizeControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fontSizeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontSizeValue: {
    fontSize: 16,
    minWidth: 32,
    textAlign: 'center',
  },
  bottomPadding: {
    height: 40,
  },
  // Form styles
  form: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  multilineInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  privateKeyInput: {
    height: 150,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  helperText: {
    fontSize: 12,
    marginBottom: 4,
  },
  keyInputHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  filePickerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  authTypeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  authTypeButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  authTypeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  autoConnectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 8,
  },
  autoConnectLabel: {
    flex: 1,
    marginRight: 12,
  },
  formButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  formButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
});
