# Picture-in-Picture (Route 1)

Background play decision, made with the user on 2026-11-26: **Route 1**.

Research verdict (not re-opened here): there is no clean, free,
ToS-compliant way to get true screen-off / app-backgrounded audio from
the official YouTube embed. YouTube Developer Policies (III.I.9)
prohibit a background player, and Google has confirmed it blocks
mobile-browser background playback for non-Premium users server-side.
Workarounds that keep the embed alive in the background or extract
its audio would break the project's own rules (Master Prompt §10)
and risk Play rejection and API-key action — they are **not built**.

Route 1 is therefore: the official embed stays exactly as it is,
playback pauses when the app is left (per YouTube policy), and
**Picture-in-Picture is enabled as the closest legal substitute** —
a small floating video window while the user does other things.
PiP is *not* screen-off audio, and nothing in the app claims it is.

No PiP button or control was added anywhere: a button that does not
reliably work on a given platform would be fake UI. PiP entry is
driven by the OS and by YouTube's own player UI, as described below.

## What was implemented

### iOS / native WebView — capability enabled (real)

Both native player components now set
`allowsPictureInPictureMediaPlayback` on the WebView:

- `src/components/video/YouTubePlayer.tsx` (watch screen)
- `src/features/sessions/components/YouTubeEmbed.tsx` (session watch)

In react-native-webview 14 this is implemented natively on iOS: it
sets `WKWebViewConfiguration.allowsPictureInPictureMediaPlayback`,
which permits an HTML5 video playing in the WebView to move into
the system PiP window (typically from the player's fullscreen
controls, or when the app is backgrounded during fullscreen
playback — the exact trigger is iOS's and YouTube's, not ours).

### Android — activity capability declared via config plugin

On Android the same WebView prop is a **no-op** inside
react-native-webview (its Android setter is an empty stub — verified
in the installed package source). Android PiP is an *activity*
capability, so it is enabled natively instead:

- `plugins/withPictureInPicture.js` — a local Expo config plugin,
  registered in `app.json`, that sets on `.MainActivity`:
  - `android:supportsPictureInPicture="true"`
  - `android:configChanges` guaranteed to include `keyboard`,
    `keyboardHidden`, `orientation`, `screenLayout`, `screenSize`,
    `smallestScreenSize`, `uiMode` (so the activity is not recreated
    on PiP entry/exit).

The project is managed (no `android/` folder in git), so the plugin
applies at prebuild / EAS build time.

**Plugin output verified** (2026-11-26): a throwaway prebuild in a
temp directory produced an `AndroidManifest.xml` whose
`.MainActivity` carries `android:supportsPictureInPicture="true"`
and the full configChanges list above. The generated folder was
discarded; nothing native was committed.

Declaring the capability does not force PiP: whether the activity
actually enters PiP — and whether the YouTube embed inside the
WebView keeps rendering there — is decided by Android, the device,
and YouTube's player.

### Web / PWA — no app-side PiP control (by design)

There is no legitimate app-side PiP switch for an embedded YouTube
iframe beyond the standard Permissions-Policy grant, and both web
players already carry it: the iframes in
`src/components/video/YouTubePlayer.web.tsx` and
`src/features/sessions/components/YouTubeEmbed.web.tsx` include
`picture-in-picture` in their `allow` attribute. That means: *if*
the browser and YouTube's player offer a PiP affordance for the
embed, it is permitted; whether they offer one is controlled by
YouTube and the browser, not by this app. No PiP button was added
to the web UI, and none should be unless it genuinely works.

## NOT VERIFIED

- **On-device behaviour on the user's OPPO (Android).** WebView
  embed PiP varies by device, Android version and YouTube's player.
  It is unknown until tested on the actual APK whether pressing
  Home during playback enters PiP, and whether the embed keeps
  playing inside the PiP window. The manifest capability is proven;
  the lived behaviour is not.
- **iOS on-device behaviour.** No iOS build has been run; the
  WKWebView flag is set, but the exact PiP trigger for the embed
  (fullscreen PiP button vs. backgrounding during fullscreen) is
  unverified.
- **Web PiP** in any specific browser — controlled by
  YouTube/browser, per above.

## On-device test checklist (run on the APK build, OPPO)

1. Open any samagam on the Watch screen, start playback, press the
   Android **Home** button.
   - Expected *possibility*: app enters a small floating PiP window
     and playback continues there.
   - If instead playback pauses / no PiP window appears, record
     exactly that — it is a device/embed limitation, not a bug to
     "fix" with background-playback workarounds.
2. During a Samagam **session** (SessionWatch), repeat step 1.
   Note whether the synchronized playback position is still correct
   after returning to the app (tap the PiP window to expand).
3. Rotate / resize behaviour: expand from PiP, confirm the app did
   not restart (position and screen state preserved — this is what
   the plugin's configChanges guarantee is for).
4. Lock the screen during playback: playback is **expected to
   pause** (YouTube policy). Confirm no UI in the app suggests
   otherwise.
5. Repeat step 1 on any second Android device available, and note
   model + Android version with the result, so the PiP support
   picture is factual rather than assumed.
