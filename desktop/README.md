# Desktop controller: Windows and macOS

Use the same Mech web controller on either platform:

| Platform | Bluetooth connection |
| --- | --- |
| Windows | Chrome connects directly to the droid through Web Bluetooth. |
| macOS | Chrome connects directly, or uses the optional native bridge below. |

## Windows

Use Windows 10 or 11 with a Bluetooth Low Energy adapter and current Google
Chrome. Install [Node.js LTS](https://nodejs.org/en/download) (24 or newer),
using the Windows installer, and [Git for Windows](https://git-scm.com/downloads/win).
Open a new PowerShell window after installation.

For a new checkout, run:

```powershell
git clone https://github.com/swishyswoosh/mech.git
cd mech\web
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

If you already have the source, open PowerShell in its `web` folder and run the
last two commands. `npm.cmd` works in PowerShell without changing its script
execution policy.

Leave that terminal running and open [Mech](http://127.0.0.1:5173/) in Chrome
on the Windows computer. Turn Bluetooth on, wake the droid and disconnect it
from any other controller. Choose **Find** on Mech's discovery screen, then
select the droid in Chrome's Bluetooth chooser and allow access. For later
connections, select it under **Saved droids**; if it is not listed, use **Find**
again.

The Windows option uses the browser's Bluetooth connection. The
`desktop-bridge` command and **DESKTOP BLUETOOTH** entry are only for the macOS
bridge. Run these Windows commands directly in Windows, rather than WSL.

If Mech is already running on port 5173, open the existing instance. If the
droid is missing from the chooser, check that the computer supports Bluetooth
Low Energy and the droid is awake and disconnected from other controllers.
Open the localhost address above rather than an HTML file: Web Bluetooth
requires a secure context such as localhost or HTTPS.

Chrome documents [Web Bluetooth support on Windows](https://developer.chrome.com/docs/capabilities/bluetooth).
Mech's Windows connection has not yet been verified on physical hardware.

## macOS Bluetooth bridge

The bridge connects Mech to R2-D2 through macOS Bluetooth while you use the
[web controller](../web/README.md) in Chrome.

### Requirements

Install Node.js 24 or newer and the Xcode Command Line Tools on your Mac. If the
tools are missing, run `xcode-select --install`; macOS may also ask you to allow
Bluetooth access for the terminal app running the bridge.

### Run

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
