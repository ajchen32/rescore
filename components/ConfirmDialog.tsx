import { useEffect } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";

import { useTheme } from "../lib/theme";

type ConfirmDialogProps = {
  title: string;
  message?: string;
  confirmLabel: string;
  // Shows the confirm button in the destructive colour.
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A themed yes/no dialog over a dimmed backdrop, used instead of the system
 * alert so it matches the app. Tapping outside or pressing Back cancels.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { colors } = useTheme();

  // Registered last, so Back closes the dialog before anything underneath reacts.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  const confirmColor = destructive ? colors.destructive : colors.controlActive;
  const confirmTextColor = destructive ? colors.background : colors.controlActiveText;

  return (
    <View className="absolute inset-0 z-50 items-center justify-center px-6">
      <Pressable
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
        onPress={onCancel}
        accessibilityLabel="Cancel"
        accessibilityRole="button"
      />
      <View
        accessibilityViewIsModal
        accessibilityRole="alert"
        className="w-full max-w-sm rounded-2xl border p-4"
        style={{ backgroundColor: colors.surfaceElevated, borderColor: colors.border }}
      >
        <Text className="text-base font-semibold" style={{ color: colors.text }}>
          {title}
        </Text>
        {message !== undefined && (
          <Text className="mt-1.5 text-sm" style={{ color: colors.textMuted }}>
            {message}
          </Text>
        )}
        <View className="mt-4 flex-row justify-end gap-2">
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            className="h-10 items-center justify-center rounded-xl border px-4"
            style={{ backgroundColor: colors.control, borderColor: colors.border }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            className="h-10 items-center justify-center rounded-xl px-4"
            style={{ backgroundColor: confirmColor }}
          >
            <Text className="text-sm font-semibold" style={{ color: confirmTextColor }}>
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
