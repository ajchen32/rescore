import { Image, type ImageProps } from "expo-image";
import { requireNativeViewManager } from "expo-modules-core";
import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

type MusicInvertViewProps = {
  inverted?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const NativeMusicInvertView = requireNativeViewManager<MusicInvertViewProps>(
  "PianoPdfParser",
  "MusicInvertView"
);

export type MusicImageProps = Omit<ImageProps, "style"> & {
  inverted?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function MusicImage({ inverted = false, style, ...imageProps }: MusicImageProps) {
  return (
    <NativeMusicInvertView
      inverted={inverted}
      style={[inverted && styles.invertedBackground, style]}
    >
      <Image {...imageProps} style={StyleSheet.absoluteFill} />
    </NativeMusicInvertView>
  );
}

const styles = StyleSheet.create({
  invertedBackground: {
    backgroundColor: "#000000",
  },
});
