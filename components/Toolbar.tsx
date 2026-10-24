import type { ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colorWithAlpha, useTheme } from "../lib/theme";

type ToolbarProps = {
  title?: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  // Replaces the title block (e.g. a search field).
  center?: ReactNode;
  // Makes the title tappable (e.g. to rename); the label describes what a tap does.
  onTitlePress?: () => void;
  titleAccessibilityLabel?: string;
  // Rounded card that floats over content (the reader) instead of a full-width bar.
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The app's one compact bar: optional left actions, a title, right actions. */
export function Toolbar({
  title,
  subtitle,
  left,
  right,
  center,
  onTitlePress,
  titleAccessibilityLabel,
  floating = false,
  style,
}: ToolbarProps) {
  const { colors } = useTheme();

  return (
    <View
      className={`flex-row items-center gap-1 px-1.5 ${floating ? "rounded-2xl" : "border-b"}`}
      style={[
        {
          minHeight: 48,
          backgroundColor: floating
            ? colorWithAlpha(colors.surfaceElevated, 0.96)
            : colors.surfaceElevated,
          borderBottomColor: colors.border,
        },
        floating && {
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 6,
          shadowColor: "#000000",
          shadowOpacity: 0.18,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        },
        style,
      ]}
    >
      {left}
      {center !== undefined ? (
        <View className="min-w-0 flex-1">{center}</View>
      ) : (
        <Pressable
          className="min-w-0 flex-1 self-stretch justify-center px-1.5"
          disabled={!onTitlePress}
          onPress={onTitlePress}
          accessibilityRole={onTitlePress ? "button" : undefined}
          accessibilityLabel={onTitlePress ? titleAccessibilityLabel : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          {title !== undefined && (
            <Text className="text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
              {title}
            </Text>
          )}
          {subtitle !== undefined && (
            <Text className="text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </Pressable>
      )}
      {right}
    </View>
  );
}
