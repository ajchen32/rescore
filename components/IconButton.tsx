import type { LucideIcon } from "lucide-react-native";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

type IconButtonProps = PressableProps & {
  icon: LucideIcon;
  label: string;
  size?: number;
  iconColor?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon: Icon,
  label,
  size = 22,
  iconColor = "#232220",
  className = "",
  style,
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      style={style}
      className={`min-h-11 min-w-11 items-center justify-center rounded-xl border ${className} ${
        disabled ? "opacity-40" : ""
      }`}
      {...props}
    >
      <Icon size={size} color={iconColor} strokeWidth={2} />
    </Pressable>
  );
}
