# macOS Bluetooth bridge

The bridge connects Mech to R2-D2 through macOS Bluetooth while you use the
[web controller](../web/README.md) in Chrome.

## Requirements

Install Node.js 24 or newer and the Xcode Command Line Tools on your Mac. If the
tools are missing, run `xcode-select --install`; macOS may also ask you to allow
Bluetooth access for the terminal app running the bridge.

## Run

After installing the web controller's dependencies, run this from `mech/web`:

```sh
npm run desktop-bridge
```

Leave the bridge running while you start the web controller in a second terminal,
following its [installation instructions](../web/README.md#install-and-run).
Open [Mech in Chrome](http://127.0.0.1:5173/), or use the
[build preview](http://127.0.0.1:5174/) if you are serving a built copy.

Disconnect the droid from other controllers, then select the entry marked
**DESKTOP BLUETOOTH** under **Saved droids**. Before the bridge has found your
droid, this entry is named **Find R2**. If it is missing, check that Bluetooth
is on and macOS has granted the terminal app Bluetooth access.

When you finish, stop the current activity and disconnect in Mech before closing
the bridge. Reloading the controller page also closes its Bluetooth connection,
so select the saved entry again to reconnect.
