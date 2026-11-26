"""Linux BlueZ GATT adapter. Only an explicit open request starts discovery."""
import asyncio
import contextlib
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gatt_sidecar import Adapter as GattAdapter, run as run_gatt, finish_cleanup


def validate_config(params):
    if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', params.get('address', '')):
        raise ValueError('invalid_config')
    if not re.fullmatch(r'hci[0-9]+', params.get('adapter', 'hci0')):
        raise ValueError('invalid_config')
    timeout = params.get('timeoutMs', 20000)
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 120000:
        raise ValueError('invalid_config')
    if not isinstance(params.get('services', []), list):
        raise ValueError('invalid_config')
    for service in params.get('services', []):
        uuid.UUID(service)


class ClientAdapter:
    """Normalize public Bleak notification callbacks to the private GATT contract."""
    def __init__(self, client):
        self.client = client

    def __getattr__(self, name):
        return getattr(self.client, name)

    async def start_notify(self, characteristic, callback):
        await self.client.start_notify(characteristic, lambda _characteristic, data: callback(data))


async def connect_backend(params, on_loss):
    validate_config(params)
    if sys.platform != 'linux':
        raise RuntimeError('linux_required')
    from bleak import BleakClient, BleakScanner

    timeout = params.get('timeoutMs', 20000) / 1000
    bluez = {'adapter': params.get('adapter', 'hci0')}
    # Scan only for the administratively enrolled address, inside the open deadline.
    device = await BleakScanner.find_device_by_address(params['address'], timeout=timeout, bluez=bluez)
    if device is None:
        raise RuntimeError('enrolled_device_unavailable')
    closing = False
    client = BleakClient(device, bluez=bluez, timeout=timeout, pair=False,
                         disconnected_callback=lambda _client: None if closing else on_loss())

    async def close():
        nonlocal closing
        closing = True
        await asyncio.wait_for(client.disconnect(), 3)

    try:
        await client.connect()
        return ClientAdapter(client), close
    except BaseException:
        with contextlib.suppress(Exception):
            await finish_cleanup(close)
        raise


class Adapter(GattAdapter):
    def __init__(self, emit, connector=connect_backend):
        super().__init__(emit, connector, validate_config)


if __name__ == '__main__':
    try:
        asyncio.run(run_gatt(Adapter))
    except (Exception, KeyboardInterrupt):
        sys.exit(1)
