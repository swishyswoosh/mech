# Mech

Mech lets you drive Sphero R2-D2, play its built-in sounds, change its lights and
combine actions into sequences.

## Install

- [Web controller](web/README.md): run locally in Chrome with Bluetooth.
- [Android app](android/README.md): install a standalone APK on Android 8 or newer.
- [Home Assistant](https://github.com/swishyswoosh/mech-hacs#installation): install through HACS.

To build the Web or Android controller, get the source first:

```sh
git clone https://github.com/swishyswoosh/mech.git
cd mech
```

The web controller also supports a [macOS Bluetooth bridge](desktop/README.md).
For a dedicated Linux host, use the [standalone service](service/README.md).
The Home Assistant panel includes driving and dome controls, while automations
and the standalone service are limited to sounds and lights. Use Web or Android
to run saved paths.

## Using Mech

After connecting, open **Drive** for the cockpit or choose **Sounds** and
**Lights** from the home screen. To combine actions into a sequence, open
**Experiences → Protocols**. Display options are in **Settings**, where you can
also enable **Depot** for diagnostics and battery profiling.

Before switching controllers, disconnect the droid in the app you were using
so the next controller can connect.

## Battery profiling

The Web and Android controllers can estimate remaining runtime by collecting
battery readings over several charge cycles.
In **Depot → Battery profiling**, choose **Start after next full charge** before
recharging, or **Start with a fully charged battery** immediately after a full
recharge. Keep Mech open and connected during normal use so it can collect
readings during quiet pauses.

Mech finishes a cycle when it records a reading during a pause in activity
while the droid reports Critical. If the battery runs out and the droid shuts down first, confirm that
in Depot promptly. Collect another cycle if you recharge before reaching low
battery, or if Depot reports too few readings after long gaps or continuous
activity.

After at least three complete cycles from a full charge to low battery, review
the proposed profile and choose **Use this profile**. A percentage marked `~` estimates runtime
remaining under similar use. When an estimate is unavailable, Mech shows the
reported battery state and voltage. **Use reported battery state** restores
the original display.

Each browser or Android installation keeps its own history and selected profile
for each droid. As you collect more readings, review any new profile in Depot
and choose **Use this profile** when you want to replace the one in use. To
export your history, choose **Prepare battery data export**, then **Save battery
JSON**.

[Contributor guidance](CONTRIBUTING.md) covers source layout, builds and tests.
Mech is licensed under [MIT](LICENSE); bundled assets and dependencies are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
