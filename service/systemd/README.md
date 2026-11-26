# Optional standalone Linux service unit

Use `mech.service` to run the standalone controller service under systemd on
Linux. For Home Assistant, use the
[HACS integration](https://github.com/swishyswoosh/mech-hacs#installation).

Follow the [standalone service guide](../README.md) to build Mech,
install its Bluetooth dependencies and create a configuration file before
installing the systemd unit.

The supplied unit runs as user/group `mech`, with access to the `bluetooth`
group. It expects the checkout at `/opt/mech`, Node at `/usr/bin/node` and your
configuration at `/etc/mech/service.json`; adjust these paths in the unit if
your installation differs. Set the configuration's database path to
`/var/lib/mech/controller.db` so the service can write to it.

Install Python and the Bluetooth dependencies outside user home directories,
which the unit blocks with `ProtectHome=true`.

From this directory on the Linux host, install and start the unit:

```sh
sudo install -m 644 mech.service /etc/systemd/system/mech.service
sudo systemctl daemon-reload
sudo systemctl enable --now mech.service
sudo systemctl status mech.service
```

Once the service is running, open Mech in the browser, sign in and choose
**Connect**. Disconnect the droid in Mech before stopping or restarting the
service to avoid interrupting an activity.
