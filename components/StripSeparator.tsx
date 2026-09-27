import { View } from "react-native";

import { STRIP_SEPARATOR_HEIGHT } from "../lib/corrections";
import { colorWithAlpha, useTheme } from "../lib/theme";

export function StripSeparator() {
  const { colors } = useTheme();

  return (
    <View
      className="w-full items-center justify-center"
      style={{ height: STRIP_SEPARATOR_HEIGHT, backgroundColor: colors.border }}
    >
      <View
        className="h-px w-full"
        style={{ backgroundColor: colorWithAlpha(colors.textMuted, 0.4) }}
      />
    </View>
  );
}
