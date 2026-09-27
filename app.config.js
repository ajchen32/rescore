const isRelease = process.env.RESCORE_VARIANT === "release";

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: "Rescore",
  slug: "piano-pdf-parser",
  scheme: "piano-pdf-parser",
  version: "1.0.0",
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#F2F1EE",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.pianopdfparser.app",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#F2F1EE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    package: "com.pianopdfparser.app",
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: "metro",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    ...(isRelease ? [] : ["expo-dev-client"]),
    "expo-font",
    "expo-image",
    [
      "expo-image-picker",
      {
        photosPermission:
          "Allow Rescore to access your photos to import sheet music.",
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F2F1EE",
        image: "./assets/splash-icon.png",
        imageWidth: 180,
      },
    ],
  ],
};

module.exports = { expo: config };
