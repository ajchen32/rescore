import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft,
  Ellipsis,
  Minus,
  Moon,
  Pencil,
  PencilLine,
  Plus,
  Sun,
  Trash2,
} from "lucide-react-native";

import { IconButton } from "./IconButton";
import { Menu } from "./Menu";
import { Toolbar } from "./Toolbar";
import { colorWithAlpha, useTheme } from "../lib/theme";

const BAR_MARGIN = 8;
const MENU_GAP = 4;
const BAR_HEIGHT = 48;
// Where the bar ends, below the top safe-area inset.
export const READER_BAR_BOTTOM = BAR_MARGIN + BAR_HEIGHT;

type ReaderBarProps = {
  visible: boolean;
  title: string;
  saveStatus: "idle" | "saving" | "saved";
  visibleCount: number;
  canDecrease: boolean;
  canIncrease: boolean;
  editing: boolean;
  garbageCount: number;
  onShow: () => void;
  onBack: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
  onToggleEdit: () => void;
  onOpenGarbage: () => void;
  onRename: () => void;
  // Any press on the bar, so the parent can postpone auto-hide.
  onInteraction: () => void;
  onMenuOpenChange: (open: boolean) => void;
};

/**
 * The reader's controls, floating over the music so showing or hiding them
 * never re-lays out the strips. When hidden, only a faint handle remains.
 */
export function ReaderBar({
  visible,
  title,
  saveStatus,
  visibleCount,
  canDecrease,
  canIncrease,
  editing,
  garbageCount,
  onShow,
  onBack,
  onDecrease,
  onIncrease,
  onToggleEdit,
  onOpenGarbage,
  onRename,
  onInteraction,
  onMenuOpenChange,
}: ReaderBarProps) {
  const { darkMode, toggleDarkMode, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const top = insets.top + BAR_MARGIN;

  const setMenu = (open: boolean) => {
    setMenuOpen(open);
    onMenuOpenChange(open);
  };

  if (!visible) {
    return (
      <Pressable
        onPress={onShow}
        accessibilityLabel="Show controls"
        accessibilityRole="button"
        hitSlop={10}
        className="absolute h-7 w-11 items-center justify-center rounded-full"
        style={{
          top: BAR_MARGIN,
          right: BAR_MARGIN,
          backgroundColor: colorWithAlpha(colors.text, 0.12),
        }}
      >
        <Ellipsis size={18} color={colorWithAlpha(colors.text, 0.55)} strokeWidth={2} />
      </Pressable>
    );
  }

  const button = { iconColor: colors.text, variant: "sm" as const, ghost: true };
  const subtitle =
    saveStatus === "saving"
      ? "Saving…"
      : editing
        ? "Editing"
        : saveStatus === "saved"
          ? "Saved"
          : undefined;

  return (
    <>
      <View
        className="absolute"
        style={{ top, left: BAR_MARGIN + insets.left, right: BAR_MARGIN + insets.right }}
        onTouchStart={onInteraction}
      >
        <Toolbar
          floating
          title={title}
          subtitle={subtitle}
          onTitlePress={onRename}
          titleAccessibilityLabel="Rename score"
          left={<IconButton icon={ChevronLeft} label="Back to library" onPress={onBack} {...button} />}
          right={
            <View className="flex-row items-center">
              <IconButton
                icon={Minus}
                label="Show fewer systems"
                onPress={onDecrease}
                disabled={!canDecrease}
                {...button}
              />
              <Text className="min-w-5 text-center text-sm font-semibold" style={{ color: colors.text }}>
                {visibleCount}
              </Text>
              <IconButton
                icon={Plus}
                label="Show more systems"
                onPress={onIncrease}
                disabled={!canIncrease}
                {...button}
              />
              {editing ? (
                <Pressable
                  onPress={onToggleEdit}
                  accessibilityLabel="Done editing"
                  accessibilityRole="button"
                  hitSlop={8}
                  className="mx-1 h-8 items-center justify-center rounded-full px-3"
                  style={{ backgroundColor: colors.controlActive }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.controlActiveText }}>
                    Done
                  </Text>
                </Pressable>
              ) : (
                <IconButton icon={Pencil} label="Correct systems" onPress={onToggleEdit} {...button} />
              )}
              <IconButton icon={Ellipsis} label="More" onPress={() => setMenu(true)} {...button} />
            </View>
          }
        />
      </View>
      {menuOpen && (
        <Menu
          top={top + BAR_HEIGHT + MENU_GAP}
          right={BAR_MARGIN + insets.right}
          onClose={() => setMenu(false)}
          items={[
            { label: "Rename", icon: PencilLine, onPress: onRename },
            {
              label: garbageCount > 0 ? `Removed systems (${garbageCount})` : "Removed systems",
              icon: Trash2,
              onPress: onOpenGarbage,
            },
            {
              label: darkMode ? "Light mode" : "Dark mode",
              icon: darkMode ? Sun : Moon,
              onPress: toggleDarkMode,
            },
          ]}
        />
      )}
    </>
  );
}
