import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../lib/theme";

export type MenuItem = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
};

type MenuProps = {
  items: MenuItem[];
  // Distance of the menu's top-right corner from the screen's top-right corner.
  top: number;
  right: number;
  onClose: () => void;
};

/** A small popover list anchored to a toolbar button; tapping outside closes it. */
export function Menu({ items, top, right, onClose }: MenuProps) {
  const { colors } = useTheme();

  return (
    <View className="absolute inset-0 z-50">
      <Pressable
        className="absolute inset-0"
        onPress={onClose}
        accessibilityLabel="Close menu"
        accessibilityRole="button"
      />
      <View
        className="absolute min-w-48 overflow-hidden rounded-xl border py-1"
        style={{
          top,
          right,
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          elevation: 8,
          shadowColor: "#000000",
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        {items.map(({ label, icon: Icon, onPress, disabled }) => (
          <Pressable
            key={label}
            disabled={disabled}
            onPress={() => {
              onClose();
              onPress();
            }}
            accessibilityRole="button"
            className={`flex-row items-center gap-3 px-4 py-3 ${disabled ? "opacity-40" : ""}`}
          >
            <Icon size={20} color={colors.text} strokeWidth={2} />
            <Text className="text-base" style={{ color: colors.text }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
