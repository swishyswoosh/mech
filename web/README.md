# Web controller

Run Mech locally with Node.js 24 or newer, then open it in Chrome on a computer
with Bluetooth. On macOS, you can also use the optional
[bridge](../desktop/README.md), which appears as **DESKTOP BLUETOOTH** under
**Saved droids**.

## Install and run

After [cloning Mech](https://github.com/swishyswoosh/mech#install), run these
commands from its `web` directory:

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Open [Mech](http://127.0.0.1:5173/) in Chrome and keep the terminal running.
If that port is already in use by Mech, open the existing instance.

## Connect and use

With Bluetooth turned on and the droid disconnected from other controllers,
choose **Find** on Mech's discovery screen. Select your droid in Chrome's device
chooser and allow access. To connect again later, choose it under **Saved droids**.
To change its displayed name, choose **Rename** after connecting, enter a name
and select **Save name**.

From the home screen, open **Sounds**, search for a sound and select **Play**.
In **Lights**, choose the part of the droid you want to change and adjust its
color or brightness. To keep a lighting combination, open **Presets**, choose
**New preset**, enter a name and choose **Save preset**. Build sequences in
**Experiences → Protocols** when you want to combine actions.

Mech stops the current activity when you switch tabs or windows, keeping
Bluetooth connected so you can use the controls again when you return. Wait
for stopping to finish before starting another action; if Mech reports a stop
error, its controls stay disabled. Reloading the page requires reconnecting to
the droid, so stop activity before reloading for an update.

## Host a built copy

Build and preview Mech locally with:

```sh
npm run build
npx vite preview --host 127.0.0.1 --port 5174 --strictPort
```

For another host, serve the generated `dist/` directory over HTTPS and open it
in Chrome on a computer near the droid. Web Bluetooth requires localhost or
HTTPS, and the computer running the browser provides the Bluetooth connection.
