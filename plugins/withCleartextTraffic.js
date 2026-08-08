/**
 * Config plugin to force `android:usesCleartextTraffic="true"` on the
 * AndroidManifest.xml `<application>` element.
 *
 * Required because Android 9+ blocks HTTP (cleartext) traffic by default,
 * and LAN qBittorrent servers use plain http://192.168.x.x addresses.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest?.application?.[0];
    if (app) {
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });
};
