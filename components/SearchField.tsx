import { Pressable, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";

import { useTheme } from "../lib/theme";

type SearchFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

/** A rounded search box sized to sit inside a Toolbar. */
export function SearchField({ value, onChangeText, placeholder = "Search" }: SearchFieldProps) {
  const { colors } = useTheme();

  return (
    <View
      className="h-9 flex-row items-center rounded-full pl-3 pr-1"
      style={{ backgroundColor: colors.background }}
    >
      <Search size={16} color={colors.textMuted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Search scores"
        className="min-w-0 flex-1 px-2 py-0 text-base"
        style={{ color: colors.text }}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText("")}
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={8}
          className="h-7 w-7 items-center justify-center rounded-full"
        >
          <X size={16} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}
