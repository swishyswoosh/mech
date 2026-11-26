# Contributing to Mech

## Source layout

Web and Android share their interface in `app/` and command/session logic in
`core/`. Platform adapters live in `web/` and `android/`; `app/platform/` provides
their shared interfaces. Metro selects `.android` implementations for Android.
Browser-specific adapters stay in `web/`; shared code uses the platform interfaces.

`desktop/` contains the macOS bridge, `service/` the standalone controller, and
`service/systemd/` its systemd unit. Unit tests belong in `test/`.

## Build and test

Use Node.js 24 or newer and install dependencies in `web/` and `android/`.
Java tests require JDK 17. From the Mech root:

```sh
npm --prefix web ci
npm --prefix android ci
npm run verify
npm run typecheck:service
```

`verify` runs the unit suites, Android type checking, a web build and an Android
JavaScript bundle. It does not install an APK or connect to hardware. APK build
instructions are in the [Android README](android/README.md).

Android supports API 26 and newer. The build uses compile SDK 37.2 and target
SDK 36. Java deprecation warnings
are errors except for documented compatibility branches. The offline build
also runs lint with API-availability errors treated as fatal.

## Session safety

Focus loss stops active controls and local routines while retaining
Bluetooth. Returning focus waits for successful STOP and leaves motion disarmed.
A failed STOP remains blocked. Queued commands retain their original source
owner and connection identity through native submission.

Manual and scheduler leases expire after 250 ms, fixed pulses after 200 ms and
Android app supervision after 500 ms. Android safety-write batches have an
800 ms deadline; app heartbeats cannot renew a source lease.

Android uses high BLE connection priority during active control and balanced
priority after a successful background STOP. Its radio worker serializes GATT
operations and rechecks source tokens at submission.

## Home Assistant shared source

The [mech-hacs repository](https://github.com/swishyswoosh/mech-hacs) contains
the Home Assistant integration, panel, blueprints and release tooling. Shared
`app/`, `core/` and `web/` files are maintained here. Commit shared changes in
Mech, then run `npm run sync:shared` from the HACS checkout. The sync records
the Mech commit and checks for conflicting edits before copying files.
