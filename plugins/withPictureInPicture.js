const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * withPictureInPicture — Route 1 (Picture-in-Picture), Android side.
 *
 * Android PiP is an Activity capability, not a WebView one: the
 * react-native-webview prop `allowsPictureInPictureMediaPlayback` is
 * a no-op setter on Android. For the app to be ABLE to enter PiP,
 * MainActivity must declare `android:supportsPictureInPicture="true"`
 * and must handle the PiP size/orientation configuration changes
 * itself (otherwise Android recreates the activity on PiP entry/exit
 * and playback state is lost).
 *
 * This plugin only declares the capability. It does NOT force PiP,
 * keep playback alive in the background, or add any PiP UI: whether
 * and when the activity actually enters PiP is decided by Android
 * and by YouTube's embedded player, and playback outside PiP still
 * pauses when the app is left, per YouTube policy (see docs/PIP.md).
 *
 * The project is managed (no android/ folder in git), so this runs
 * at prebuild / EAS build time.
 */

// configChanges values Android requires an activity to handle itself
// for smooth PiP transitions (size + layout changes without restart).
const PIP_CONFIG_CHANGES = [
  'keyboard',
  'keyboardHidden',
  'orientation',
  'screenLayout',
  'screenSize',
  'smallestScreenSize',
  'uiMode',
];

function withPictureInPicture(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const mainActivity = activities.find((activity) => {
      const name = activity.$?.['android:name'] ?? '';
      return name === '.MainActivity' || name.endsWith('.MainActivity');
    });

    if (mainActivity) {
      mainActivity.$['android:supportsPictureInPicture'] = 'true';

      const existing = (mainActivity.$['android:configChanges'] ?? '')
        .split('|')
        .map((value) => value.trim())
        .filter(Boolean);
      const merged = [...existing];
      for (const required of PIP_CONFIG_CHANGES) {
        if (!merged.includes(required)) {
          merged.push(required);
        }
      }
      mainActivity.$['android:configChanges'] = merged.join('|');
    }

    return config;
  });
}

module.exports = withPictureInPicture;
