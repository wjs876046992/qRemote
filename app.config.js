const packageJson = require('./package.json');

// Set via eas.json's "development" build profile `env` block (NOT
// EAS_BUILD_PROFILE — that's only injected in the remote build worker, not
// during eas-cli's local pre-build config resolution, which is when
// credentials/bundle id registration happens). A distinct bundle id lets the
// dev-client build install side-by-side with the App Store build on device.
const isDevelopmentBuild = process.env.APP_VARIANT === 'development';

module.exports = {
  expo: {
    name: 'qRemote',
    slug: 'qremote',
    version: packageJson.version, // Single source of truth: package.json
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'qremote',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0A0A0A',
    },
    // NOTE: ios/ is generated, not committed (untracked since #154). `npm run
    // xcode` prebuilds/pod installs it. `package.json` EAS tags govern builds.
    ios: {
      bundleIdentifier: isDevelopmentBuild
        ? 'team.blechstephens.qremote.development'
        : 'team.blechstephens.qremote',
      supportsTablet: true,
      usesAppleSignIn: false,
      infoPlist: {
        UIBackgroundModes: ['fetch'],
        LSApplicationQueriesSchemes: ['qremote'],
        NSPhotoLibraryUsageDescription:
          'Allow qRemote to access your photos so you can select a downloaded torrent to upload and share.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: isDevelopmentBuild
        ? 'team.blechstephens.qremote.development'
        : 'team.blechstephens.qremote',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0A0A0A',
      },
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'qremote',
            },
            {
              scheme: 'magnet',
            },
            {
              mimeType: 'application/x-bittorrent',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
        {
          action: 'SEND',
          data: [
            {
              mimeType: 'application/x-bittorrent',
            },
            {
              mimeType: 'text/plain',
            },
          ],
          category: ['DEFAULT'],
        },
      ],
      userInterfaceStyle: 'automatic',
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-localization',
      'expo-secure-store',
      'expo-sharing',
      'expo-status-bar',
      './plugins/withNativeTorrentFileCopy',
      './plugins/withCleartextTraffic',
      // Xcode 27 / iOS 27 SDK hard-fails app launch unless the generated
      // native project adopts the UIScene life cycle — Expo SDK 57.0.23+
      // ships that support, but only behind this opt-in flag (full default
      // adoption doesn't land until SDK 58). Without it, `npm run xcode`
      // produces a build that crashes instantly on any Xcode 27 toolchain,
      // regardless of which simulator OS it's run on.
      [
        'expo-build-properties',
        {
          ios: {
            enableSceneSupport: true,
          },
        },
      ],
    ],
    extra: {
      router: {},
      eas: {
        projectId: '966955ee-920d-473b-bd03-02d74460eeb4',
      },
    },
    updates: {
      url: 'https://u.expo.dev/e2539074-777d-46d3-ae9e-9e584f9e9bb0',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    owner: 'blechstephens-team',
  },
};
