const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Both clients import these shared sources. Resolve their runtime packages from
// the mobile install so a native-only build does not require the Web install.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, "../src/shared"),
  path.resolve(__dirname, "../src/contracts"),
];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, "node_modules"),
  ...config.resolver.nodeModulesPaths,
];

module.exports = config;
