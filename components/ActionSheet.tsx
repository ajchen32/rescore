import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../lib/theme";

export type ActionSheetItem = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
};

type ActionSheetProps = {
  title: string;
  items: ActionSheetItem[];
  onClose: () => void;
};

/**
 * A list of actions for one item at the bottom of the screen; tapping outside
 * closes it. Render it inside the safe area (it adds no inset of its own).
 */
export function ActionSheet({ title, items, onClose }: ActionSheetProps) {
  const { colors } = useTheme();

  return (
    <View className="absolute inset-0 z-50 justify-end">
      <Pressable
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
        onPress={onClose}
        accessibilityLabel="Close"
        accessibilityRole="button"
      />
      <View
        className="mx-2 mb-2 overflow-hidden rounded-2xl border py-1"
        style={{
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
        }}
      >
        <Text
          className="px-4 pb-1 pt-3 text-sm font-semibold"
          style={{ color: colors.textMuted }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {items.map(({ label, icon: Icon, onPress, destructive }) => {
          const color = destructive ? colors.destructive : colors.text;
          return (
            <Pressable
              key={label}
              onPress={() => {
                onClose();
                onPress();
              }}
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-4 py-3"
            >
              <Icon size={20} color={color} strokeWidth={2} />
              <Text className="text-base" style={{ color }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
