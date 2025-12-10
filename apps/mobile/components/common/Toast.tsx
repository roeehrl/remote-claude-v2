import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Animated,
  Pressable,
  Platform,
} from 'react-native';
import { Text } from '@/components/Themed';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ============================================================================
// Types
// ============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

// ============================================================================
// Toast Item Component
// ============================================================================

const TOAST_COLORS: Record<ToastType, { bg: string; icon: string; iconName: keyof typeof Ionicons.glyphMap }> = {
  success: { bg: '#10b981', icon: '#fff', iconName: 'checkmark-circle' },
  error: { bg: '#ef4444', icon: '#fff', iconName: 'close-circle' },
  warning: { bg: '#f59e0b', icon: '#fff', iconName: 'warning' },
  info: { bg: '#3b82f6', icon: '#fff', iconName: 'information-circle' },
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(() => {
      dismissToast();
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const dismissToast = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -20,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss(toast.id);
    });
  };

  const colors = TOAST_COLORS[toast.type];

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: colors.bg, opacity, transform: [{ translateY }] },
      ]}
    >
      <Ionicons name={colors.iconName} size={20} color={colors.icon} />
      <View style={styles.toastContent}>
        <Text style={styles.toastTitle}>{toast.title}</Text>
        {toast.message && (
          <Text style={styles.toastMessage}>{toast.message}</Text>
        )}
      </View>
      <Pressable onPress={dismissToast} style={styles.dismissButton}>
        <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
      </Pressable>
    </Animated.View>
  );
}

// ============================================================================
// Toast Container Component
// ============================================================================

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { top: insets.top + 8 }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
    ...Platform.select({
      web: {
        maxWidth: 400,
        alignSelf: 'center',
        left: 'auto',
        right: 'auto',
      },
    }),
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  toastContent: {
    flex: 1,
  },
  toastTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  toastMessage: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    marginTop: 2,
  },
  dismissButton: {
    padding: 4,
  },
});
