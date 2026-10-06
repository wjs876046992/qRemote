const { withAppDelegate } = require('expo/config-plugins');

// Scene-lifecycle builds (see app.config.js's expo-build-properties
// enableSceneSupport, added for Xcode 27) no longer create the UIWindow or
// call factory.startReactNative from here — ExpoReactNativeFactoryProvider
// conformance lets Expo's own scene delegate reach back into this AppDelegate
// and drive startup itself, from its own UIScene connection options rather
// than this method's launchOptions. That means this method can no longer
// GUARANTEE the resolved URL reaches React's initial props the way it could
// when it called startReactNative directly — see the doc comment on
// withNativeTorrentFileCopy below for what that means in practice.
const OLD_LAUNCH_METHOD = `  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }`;

// A cold launch (app not running) delivers the opening URL through
// launchOptions[.url] here rather than through the "open url" delegate method
// below — that method is only called when the app is already running. We
// still copy it eagerly here (cheap, harmless) so the security-scoped access
// window is as early as possible, but under scene lifecycle this method no
// longer calls factory.startReactNative itself, so there is no longer a
// direct path from here to feed the copied URL into React's initial launch
// options. Verify cold-launch "Open In" from Files still works correctly —
// if Expo's scene delegate reads its own connection options independently of
// this method's (mutated) launchOptions, this early copy may be a no-op for
// that path and a scene-delegate-level fix would be needed instead.
const NEW_LAUNCH_METHOD = `  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    if let originalURL = launchOptions?[UIApplication.LaunchOptionsKey.url] as? URL {
      _ = AppDelegate.copySecurityScopedFileIfNeeded(originalURL)
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }`;

const OLD_METHOD = `  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }`;

const NEW_METHOD = `  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    let resolvedURL = AppDelegate.copySecurityScopedFileIfNeeded(url)
    return super.application(app, open: resolvedURL, options: options) || RCTLinkingManager.application(app, open: resolvedURL, options: options)
  }

  // iOS hands "Open In Place" documents (Files app tap-to-open / long-press ->
  // Open In) to this callback as security-scoped file:// URLs whose access is
  // only guaranteed valid for the lifetime of this call. Copying the file here
  // — synchronously, before returning — avoids a race where that access lapses
  // before the async JS Linking handler (app/_layout.tsx) gets a chance to read
  // it. JS then only ever sees a plain, already-copied file it fully owns.
  private static func copySecurityScopedFileIfNeeded(_ url: URL) -> URL {
    guard url.isFileURL else { return url }

    let didStartAccessing = url.startAccessingSecurityScopedResource()
    defer {
      if didStartAccessing {
        url.stopAccessingSecurityScopedResource()
      }
    }

    guard let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return url
    }
    let destDir = cachesDir.appendingPathComponent("incoming-torrents", isDirectory: true)

    do {
      try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
      let destURL = destDir.appendingPathComponent("\\(Int(Date().timeIntervalSince1970 * 1000))-\\(url.lastPathComponent)")
      if FileManager.default.fileExists(atPath: destURL.path) {
        try FileManager.default.removeItem(at: destURL)
      }
      try FileManager.default.copyItem(at: url, to: destURL)
      return destURL
    } catch {
      return url
    }
  }`;

/**
 * Patches the generated AppDelegate.swift so incoming "Open In Place" file
 * handoffs (see LSSupportsOpeningDocumentsInPlace in app.config.js) are copied
 * into the app's sandbox natively, before JS ever sees the URL. Without this,
 * reading the security-scoped URL from JS is a race the async Linking bridge
 * usually loses (see services/incoming-file.ts).
 *
 * The "open url" delegate method (app already running) is patched the same
 * way it always was and is unaffected by scene lifecycle. The cold-launch
 * path (app not running) is weaker under scene lifecycle (see
 * app.config.js's expo-build-properties enableSceneSupport, added for Xcode
 * 27): factory.startReactNative used to be called from right here, fed the
 * resolved URL directly; now Expo's own scene delegate drives that call from
 * its own UIScene connection options, so this method copying the file no
 * longer has a direct path to feed the result into React's initial launch
 * options. Verify cold-launch "Open In" from Files still resolves correctly
 * after any Expo/scene-support version bump — if it regresses, the fix likely
 * needs to move to a custom UISceneDelegate rather than this method.
 *
 * ios/ is regenerated by every `expo prebuild` (npm run xcode), so this must
 * be a config plugin rather than a one-off hand-edit of AppDelegate.swift —
 * a hand-edit would be silently overwritten by the next prebuild.
 */
module.exports = function withNativeTorrentFileCopy(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes('copySecurityScopedFileIfNeeded')) {
      // Already patched (e.g. re-running prebuild) — leave it alone.
      return config;
    }

    if (!contents.includes(OLD_LAUNCH_METHOD)) {
      throw new Error(
        'withNativeTorrentFileCopy: expected AppDelegate.swift "didFinishLaunchingWithOptions" ' +
          'method not found. The Expo template likely changed — update plugins/withNativeTorrentFileCopy.js to match.',
      );
    }
    if (!contents.includes(OLD_METHOD)) {
      throw new Error(
        'withNativeTorrentFileCopy: expected AppDelegate.swift "open url" method not found. ' +
          'The Expo template likely changed — update plugins/withNativeTorrentFileCopy.js to match.',
      );
    }

    contents = contents.replace(OLD_LAUNCH_METHOD, NEW_LAUNCH_METHOD);
    contents = contents.replace(OLD_METHOD, NEW_METHOD);
    config.modResults.contents = contents;
    return config;
  });
};
