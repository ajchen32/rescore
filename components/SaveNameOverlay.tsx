import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from "react-native";
import { Save, X } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { useTheme } from "../lib/theme";

const KEYBOARD_GAP = 12;

type AvoidKeyboardMode = "padding" | "overlap";

type SaveNameOverlayProps = {
  initialTitle: string;
  saving: boolean;
  heading?: string;
  cancelAccessibilityLabel?: string;
  confirmAccessibilityLabel?: string;
  avoidKeyboard?: AvoidKeyboardMode;
  onCancel: () => void;
  onConfirm: (title: string) => void;
};

export function defaultSaveTitle(name: string | null): string {
  const base = (name ?? "Untitled score").trim();
  const withoutExtension = base.replace(/\.(pdf|jpe?g|png|heic|webp|gif)$/i, "").trim();
  return withoutExtension.length > 0 ? withoutExtension : "Untitled score";
}

export function SaveNameOverlay({
  initialTitle,
  saving,
  heading = "Name",
  cancelAccessibilityLabel = "Cancel save",
  confirmAccessibilityLabel,
  avoidKeyboard = "padding",
  onCancel,
  onConfirm,
}: SaveNameOverlayProps) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(initialTitle);
  const [cardShiftY, setCardShiftY] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const cardRef = useRef<View>(null);
  const keyboardVisibleRef = useRef(false);
  const keyboardTopRef = useRef(0);

  useEffect(() => {
    setDraft(initialTitle);
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [initialTitle]);

  const updateOverlapShift = useCallback(() => {
    if (!keyboardVisibleRef.current || !cardRef.current) {
      setCardShiftY(0);
      return;
    }

    cardRef.current.measureInWindow((_x, y, _width, height) => {
      const cardBottom = y + height;
      const overlap = cardBottom + KEYBOARD_GAP - keyboardTopRef.current;
      setCardShiftY(overlap > 0 ? overlap : 0);
    });
  }, []);

  useEffect(() => {
    if (avoidKeyboard !== "overlap") {
      return;
    }

    const handleKeyboardShow = (event: KeyboardEvent) => {
      keyboardVisibleRef.current = true;
      keyboardTopRef.current = event.endCoordinates.screenY;
      updateOverlapShift();
    };

    const handleKeyboardHide = () => {
      keyboardVisibleRef.current = false;
      keyboardTopRef.current = 0;
      setCardShiftY(0);
    };

    const showSubscription = Keyboard.addListener("keyboardDidShow", handleKeyboardShow);
    const hideSubscription = Keyboard.addListener("keyboardDidHide", handleKeyboardHide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [avoidKeyboard, updateOverlapShift]);

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !saving;
  const saveLabel = confirmAccessibilityLabel ?? (saving ? "Saving" : "Save");

  const card = (
    <View
      ref={avoidKeyboard === "overlap" ? cardRef : undefined}
      onLayout={avoidKeyboard === "overlap" ? updateOverlapShift : undefined}
      className="w-full max-w-md rounded-2xl border p-5"
      style={[
        { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
        avoidKeyboard === "overlap" ? { transform: [{ translateY: -cardShiftY }] } : null,
      ]}
    >
      <Text className="text-lg font-semibold" style={{ color: colors.text }}>
        {heading}
      </Text>

      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        selectTextOnFocus
        editable={!saving}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (canSave) {
            onConfirm(trimmed);
          }
        }}
        className="mt-4 rounded-xl border px-4 py-3 text-base"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.background,
          color: colors.text,
        }}
        placeholder="Piece name"
        placeholderTextColor={colors.textMuted}
      />

      <View className="mt-5 flex-row justify-end gap-2">
        <IconButton
          icon={X}
          label={cancelAccessibilityLabel}
          iconColor={colors.text}
          onPress={onCancel}
          disabled={saving}
          style={{ backgroundColor: colors.control, borderColor: colors.border }}
        />
        <Pressable
          onPress={() => onConfirm(trimmed)}
          disabled={!canSave}
          accessibilityLabel={saveLabel}
          accessibilityRole="button"
          className="min-h-11 min-w-11 items-center justify-center rounded-xl"
          style={{
            backgroundColor: canSave ? colors.controlActive : colors.border,
          }}
        >
          {saving ? (
            <Text style={{ color: colors.textMuted }}>…</Text>
          ) : (
            <Save
              size={22}
              color={canSave ? colors.controlActiveText : colors.textMuted}
              strokeWidth={2}
            />
          )}
        </Pressable>
      </View>
    </View>
  );

  if (avoidKeyboard === "overlap") {
    return (
      <View style={[styles.overlay, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>{card}</View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.overlay, { backgroundColor: colors.background }]}
    >
      <View style={styles.centered}>{card}</View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
});
