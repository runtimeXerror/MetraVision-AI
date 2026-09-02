// Standalone Expo app — no monorepo/workspace resolution needed in Phase 1.
// When the backend and shared packages land in Phase 2, add `watchFolders`
// and `nodeModulesPaths` here rather than changing any application code.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
