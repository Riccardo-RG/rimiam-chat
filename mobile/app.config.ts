import type { ExpoConfig } from "expo/config";

const identifier = process.env.RIMIAM_MOBILE_APP_ID || "com.rimiam.chat";
const config: ExpoConfig = {
  name: "RIMIAM",
  slug: "rimiam-chat",
  scheme: ["rimiam", "com.rimiam.chat"],
  version: "0.1.0",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  locales: { it: "./assets/locales/it.json", en: "./assets/locales/en.json" },
  ios: {
    bundleIdentifier: identifier,
    supportsTablet: true,
    infoPlist: {
      CFBundleDevelopmentRegion: "en",
      CFBundleLocalizations: ["en", "it"],
    },
  },
  android: {
    package: identifier,
    googleServicesFile: process.env.RIMIAM_ANDROID_GOOGLE_SERVICES_FILE,
  },
  plugins: [
    "./plugins/with-notification-copy.cjs",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission: "Choose photos to share in your conversation.",
        cameraPermission: "Take a photo to attach to a message.",
        microphonePermission: false,
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission:
          "Use your microphone for voice messages and audio calls.",
      },
    ],
    [
      "expo-notifications",
      {
        mode:
          process.env.RIMIAM_IOS_APNS_ENVIRONMENT === "production"
            ? "production"
            : "development",
        defaultChannel: "rimiam-updates",
      },
    ],
    "expo-web-browser",
    [
      "@livekit/react-native-expo-plugin",
      { android: { audioType: "communication" } },
    ],
    [
      "@config-plugins/react-native-webrtc",
      {
        cameraPermission: "Take a photo to attach to a message.",
        microphonePermission:
          "Use your microphone for voice messages and audio calls.",
      },
    ],
  ],
};

export default config;
