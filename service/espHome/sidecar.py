"""Private inherited-stdio GATT adapter. Importing this module does no I/O.

Protocol/session semantics remain in TypeScript. Each process owns one epoch and
one explicitly enrolled BLE address; neither connection nor writes are retried.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import re
import sys
import uuid

MAX_LINE = 65536


def validate_config(params):
    if not isinstance(params.get('host'), str) or not params['host']:
        raise ValueError('invalid_config')
    if not isinstance(params.get('port', 6053), int) or not 1 <= params.get('port', 6053) <= 65535:
        raise ValueError('invalid_config')
    if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', params.get('address', '')):
        raise ValueError('invalid_config')
    encryption_key = base64.b64decode(params.get('encryptionKey', ''), validate=True)
    if len(encryption_key) != 32 or not any(encryption_key):
        raise ValueError('invalid_config')
    if params.get('addressType', 0) not in (0, 1):
        raise ValueError('invalid_config')
    timeout = params.get('timeoutMs', 20000)
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 120000:
        raise ValueError('invalid_config')
    if not isinstance(params.get('services', []), list):
        raise ValueError('invalid_config')
    for service in params.get('services', []):
        uuid.UUID(service)


class NoDiscovery:
    """The backend's scanner context is a no-op because no scan is registered.

    ESPHomeClient 4.1.0 only uses scanner.connecting() to pause scanner expiry.
    A private enrolled-address connection has no scanner expiry to pause.
    """
    def connecting(self):
        return contextlib.nullcontext()


async def connect_backend(params, on_loss):
    # Lazy imports allow offline dispatcher tests without dependency installation.
    from aioesphomeapi import APIClient, BluetoothProxyFeature
    from bleak.backends.device import BLEDevice
    from bleak_esphome.backend.client import ESPHomeClient, ESPHomeClientData
    from bleak_esphome.backend.device import ESPHomeBluetoothDevice

    validate_config(params)
    api = APIClient(params['host'], params.get('port', 6053), password='',
                    noise_psk=params['encryptionKey'], client_info='Mech private GATT')
    client = None
    device = None
    callbacks = set()
    closing = False

    async def api_lost(_expected):
        if device is not None:
            device.async_set_unavailable()
        for callback in tuple(callbacks):
            callback()
        if not closing:
            on_loss()

    async def close():
        nonlocal closing
        closing = True
        try:
            if client is not None and client.is_connected:
                await asyncio.wait_for(client.disconnect(), 3)
        finally:
            await asyncio.wait_for(api.disconnect(), 3)

    try:
        await api.connect(on_stop=api_lost, login=True, log_errors=False)
        info = await api.device_info()
        flags = info.bluetooth_proxy_feature_flags_compat(api.api_version)
        if not flags & BluetoothProxyFeature.ACTIVE_CONNECTIONS:
            raise ValueError('active_proxy_required')
        source = info.bluetooth_mac_address or info.mac_address
        device = ESPHomeBluetoothDevice(info.name, source, available=True)
        api.subscribe_bluetooth_connections_free(device.async_update_ble_connection_limits)
        data = ESPHomeClientData(bluetooth_device=device, client=api,
                                device_info=info, api_version=api.api_version,
                                title=info.name, scanner=NoDiscovery(),
                                disconnect_callbacks=callbacks)
        ble_device = BLEDevice(params['address'], 'Enrolled droid',
                               {'source': source, 'address_type': params.get('addressType', 0)})
        client = ESPHomeClient(ble_device, client_data=data,
                              disconnected_callback=lambda: None if closing else on_loss(),
                              timeout=params.get('timeoutMs', 20000) / 1000)
        await client.connect(pair=False)
        return client, close
    except BaseException:
        with contextlib.suppress(Exception):
            await finish_cleanup(close)
        raise


# Direct execution and importlib tests use the same shared dispatcher.
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gatt_sidecar import Adapter as GattAdapter, run as run_gatt, finish_cleanup

class Adapter(GattAdapter):
    def __init__(self, emit, connector=connect_backend):
        super().__init__(emit, connector, validate_config)

async def run():
    await run_gatt(Adapter)

if __name__ == '__main__':
    try:
        asyncio.run(run())
    except (Exception, KeyboardInterrupt):
        sys.exit(1)
