# Optional standalone controller service

Run Mech on a Linux computer to control R2-D2's sounds and lights from a browser
on that host. For Home Assistant, use the [HACS integration](https://github.com/swishyswoosh/mech-hacs#installation)
instead.

## Install and configure

On a Linux computer with Bluetooth, install Node.js 24 or newer, Python
3.11–3.14 and uv; ARM computers also need a 64-bit OS. Build Mech and install
its Bluetooth dependencies from the checkout's root directory:

```sh
npm --prefix web ci
npm --prefix web run build -- --base ./
uv sync --frozen --project service/bluez
```

Copy [`config.example.json`](config.example.json) to a private location. Set the
droid's Bluetooth `address` and `name`, and check that `bluetooth.adapter` names
your adapter (usually `hci0`).

Generate a sign-in token and its SHA-256 digest:

```sh
node <<'JS'
const crypto = require('node:crypto');
const token = crypto.randomBytes(32).toString('hex');
const sha256 = crypto.createHash('sha256').update(token).digest('hex');
console.log(JSON.stringify({ token, sha256 }, null, 2));
JS
```

Copy `sha256` into `tokens[].sha256` in your configuration, and use `token` to
sign in. Keep the configuration file and sign-in token private.

## Start and use

From the checkout's root directory, start the service with your configuration:

```sh
node --experimental-strip-types service/main.ts /private/path/service.json
```

Disconnect the droid from any other controller, then open
[Mech](http://127.0.0.1:8787/), sign in with your token and choose the droid under
**Saved droids**, or use **Connect** to select it.

Open **Sounds** to search the sound library and play a selection, or **Lights**
to adjust the droid's lighting. To save a combination, open **Lights → Presets →
New preset**, enter a name and choose **Save preset**. For a sequence of light
effects, open **Experiences → Protocols**.
Driving, dome movement and animations that move the droid are unavailable.

When you leave the page, Mech stops the current activity and keeps the droid
connected. If you stop or restart the service, reconnect to the droid once the
service is running again.

Keep the default local-only address for use on this computer. For access from
other computers, put an HTTPS reverse proxy in front of the service, set
`origins` to the browser's exact HTTPS origin and set `secureCookies` to `true`
in the private configuration. Keep the service bound to loopback when the proxy
runs on the same host. Binding to another interface additionally requires
`allowLan: true`; restrict access to that listener to the proxy.
For automatic startup on Linux, follow the [systemd instructions](systemd/README.md).
