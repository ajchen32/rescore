import type { LucideIcon } from "lucide-react-native";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

type IconButtonProps = PressableProps & {
  icon: LucideIcon;
  label: string;
  size?: number;
  iconColor?: string;
  // "sm" draws a 36 px button but keeps a 44 px touch target via hitSlop.
  variant?: "md" | "sm";
  // No border, for buttons sitting on a toolbar.
  ghost?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

const SMALL_HIT_SLOP = 4;

export function IconButton({
  icon: Icon,
  label,
  size,
  iconColor = "#232220",
  variant = "md",
  ghost = false,
  className = "",
  style,
  disabled,
  ...props
}: IconButtonProps) {
  const small = variant === "sm";
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={small ? SMALL_HIT_SLOP : undefined}
      style={style}
      className={`items-center justify-center rounded-xl ${small ? "h-9 min-h-9 min-w-9" : "min-h-11 min-w-11"} ${
        ghost ? "" : "border"
      } ${className} ${disabled ? "opacity-40" : ""}`}
      {...props}
    >
      <Icon size={size ?? (small ? 20 : 22)} color={iconColor} strokeWidth={2} />
    </Pressable>
  );
}
