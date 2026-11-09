# TEMPEST Companion (Android)

TEMPEST on your tablet or phone, while TEMPEST itself runs on your PC. Your campaigns stay on
the PC; the app opens TEMPEST's own pages over Wi-Fi:

- **As the GM:** the whole GM window (characters, the Forge, maps, the initiative tracker,
  pushing to players), through **GM on your network**.
- **As a player screen:** the player screen, full screen and kept awake, through **Player screen
  on your network**.

## Using it as the GM

1. On the PC: **TEMPEST › Project settings › GM on your network**, tick **Let my tablet or phone
   be the GM window** (it asks you to confirm: a paired device can do anything the PC's window can).
2. On the tablet (same Wi-Fi), open **TEMPEST**, tap **Scan a TEMPEST QR code** and scan the code
   on the PC. The GM window opens, in landscape.
3. Next time the app goes straight back to it.

- **What stays on the PC:** shutting TEMPEST down, autostart, importing the screamsheet PDF from
  the PC's disk, and both network settings. Everything else works from the tablet, picture
  uploads included (they open Android's picker).
- **Signing devices out:** **New key** on the PC signs every paired device out at once.
- **Trust:** it's plain http on your network, like the player screen. Use it on networks you trust
  (home Wi-Fi), not public ones, and keep the GM code to yourself.
- **Downloads** (exporting a preset as a file) don't work inside the app yet: do those on the PC.
- The GM window is laid out for wide screens, so GM mode keeps the device in landscape.

## Using it as a player screen

1. On the PC: **Project settings › Player screen on your network**, turn sharing on.
2. On the phone or tablet, tap **Scan a TEMPEST QR code** and scan the player screen's code (or
   paste its link). Scanning with the phone's camera app works too: open the link with TEMPEST.
3. Pick a name for the screen and play.

## Both

- **Android 17 and newer** ask whether TEMPEST may reach **devices on your local network**: allow
  it, or the app can't reach the PC at all. (Refused it? The app explains and opens its settings.)
  The same goes for Chrome, if you open TEMPEST's links there instead.
- **Back** steps back inside the page (a Codex entry, say); press it twice to leave.
- **Can't reach the GM's screen?** Check the Wi-Fi and that TEMPEST is running with sharing on,
  then **Try again**. A link stops working when a new one is made on the PC: scan the new code.
- **Join another table** or **Forget this table** on the start screen to switch.
- Scanning uses Google's code scanner (part of Google Play services, no camera permission). On a
  device without Play services, paste the link instead.

## Building

Needs the **Android SDK** with platform 37 (Android Studio installs it) and a **JDK 17 or newer**
(Android Studio's own, in `Android Studio\jbr`, works). The project uses the Android Gradle plugin
9.5 and the Gradle wrapper (Gradle 9.8.2), which downloads Gradle on first use.

- **Android Studio:** *Open* this `android/` folder, let it sync, then **Build › Build App
  Bundle(s) / APK(s) › Build APK(s)**.
- **Command line** (Windows; `./gradlew` elsewhere), with `JAVA_HOME` set to a JDK and the SDK in
  `android/local.properties` (`sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk`, which
  Android Studio writes on first open):

  ```bash
  cd android
  gradlew.bat assembleDebug
  ```

  The app is `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the device and open
  it to install (allow installing from that source when Android asks), or `adb install` it.

The app's version follows TEMPEST's (`package.json`). A release build for sharing needs your own
signing key (`gradlew assembleRelease` with a `signingConfig`); never commit the key.

**Testing on this PC:** Android Studio's virtual phones need hardware virtualization: the *Android
Emulator hypervisor driver* (SDK Manager › SDK Tools) or *Windows Hypervisor Platform*. A virtual
device reaches TEMPEST on the same PC at `10.0.2.2` (e.g. `http://10.0.2.2:4079/gm?k=…`, with the
key from the PC's link).

## How it works

- `MainActivity`: the start screen (scan, paste, back to the last table), and the handler for
  `http://<any host>/gm?k=…` and `…/join?k=…` links opened from other apps.
- `ScreenActivity`: a WebView on the link (which sets TEMPEST's key cookie), then on the GM window
  (`/`) or the player screen (`/#/player`). GM: a normal landscape window that makes room for the
  keyboard, with a file picker. Player: full screen. Links off the table open in the browser.
- `Table`: checks and remembers the link.
- Plain `http` is allowed (`res/xml/network_security_config.xml`) because TEMPEST shares on the
  local network without a certificate; the link's key is what lets a device in.

On the PC side, GM on your network is `server/gm-lan.js`: its own port (4079 by default), its own
key, and requests passed to the GM server's handler as *remote* ones (`server/index.js`).
