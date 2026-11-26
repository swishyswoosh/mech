# Android controller

Mech runs on Android 8 or newer, including the Galaxy S9. The standalone APK
works offline and connects directly to the droid over Bluetooth.

## Install and connect

Open the APK on the phone, allow installation from your file manager when
Android asks, and complete the installation prompt. If you are upgrading,
stop any current activity first; installing an update restarts Mech and
interrupts its Bluetooth connection.

Before connecting, disconnect the droid from any other controller. Open Mech,
grant its Bluetooth permissions and choose **Find** on the discovery screen,
then select your droid. Next time, choose its entry under **Saved droids** to
reconnect. To change the displayed name after connecting, choose **Rename**,
enter a name and select **Save name**.

## Using the controller

Open **Drive** from the home screen to use the landscape cockpit. For quick
access to a sound, find and select it in **Sounds**, choose **1** under
**COCKPIT BUTTON** and select **Save to cockpit button 1**. You can then play
that sound from the first cockpit button while driving.

Open **Experiences → Protocols** to build sequences of actions. To save a
lighting combination for later, open **Lights → Presets → New preset**, enter
a name and choose **Save preset**.

If you switch to another app, Mech stops the activity and keeps Bluetooth
connected. When you return, wait for stopping to finish before using the
controls again. If stopping fails, Mech displays an error and keeps the
controls disabled.

Change theme and input preferences in **Settings**, then choose **Save
preferences**. You can also enable **Depot** there to access diagnostics and
battery profiling.

## Build an APK

To build the app yourself, install Node.js 24 or newer, JDK 17, Android SDK
Platform 37.2, Build Tools 37.0.0 and NDK 27.1.12297006. Set `JAVA_HOME` and
`ANDROID_HOME` to your Java and Android SDK installations.

After [cloning Mech](https://github.com/swishyswoosh/mech#install), run these
commands from its `android` directory:

```sh
npm ci
./gradlew :app:assembleOffline --no-daemon --console=plain
```

The APK is written to `app/build/outputs/apk/offline/app-offline.apk`. This build
uses a development signing key; distributing an APK requires your own release
signing setup. See [contributor guidance](../CONTRIBUTING.md) for compatibility
requirements and tests.

To install your build over USB, enable USB debugging and authorize the computer
on the phone, then run:

```sh
adb devices
adb install -r app/build/outputs/apk/offline/app-offline.apk
adb shell am start -n local.r2controller/.MainActivity
```

Use `adb -s SERIAL` to select a device if more than one is attached.
