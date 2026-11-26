"""No radio/network access: injected BLE boundary tests of the actual IPC dispatcher."""
import asyncio
import base64
import importlib.util
import pathlib
import unittest
from types import SimpleNamespace

path = pathlib.Path(__file__).resolve().parents[2] / 'service/espHome/sidecar.py'
spec = importlib.util.spec_from_file_location('sidecar', path)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
S = '00000001-0000-1000-8000-00805f9b34fb'
C = '00000002-0000-1000-8000-00805f9b34fb'
REF = {'service': S, 'characteristic': C}

class FakeBle:
    def __init__(self):
        self.char = SimpleNamespace(uuid=C, service_uuid=S, handle=7)
        self.services = [SimpleNamespace(uuid=S, characteristics=[self.char])]
        self.mtu_size = 23
        self.writes = []
        self.notify = None
        self.closed = False
    async def read_gatt_char(self, characteristic):
        assert characteristic is self.char
        return bytearray([0, 255, 128])
    async def write_gatt_char(self, characteristic, data, response):
        assert characteristic is self.char
        self.writes.append((bytes(data), response))
    async def start_notify(self, characteristic, callback):
        assert characteristic is self.char
        self.notify = callback
        callback(bytearray([9, 255]))  # Delivery can precede CCCD completion.
        await asyncio.sleep(0)
    async def stop_notify(self, characteristic):
        self.notify = None
    async def disconnect(self):
        self.closed = True

class SidecarTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.ble = FakeBle()
        self.events = []
        self.connects = 0
        async def connect(params, on_loss):
            self.connects += 1
            self.on_loss = on_loss
            return self.ble, self.ble.disconnect
        self.adapter = sidecar.Adapter(self.events.append, connect)
    async def call(self, method, params=None, epoch=1):
        return await self.adapter.handle({'id':len(self.events)+1,'epoch':epoch,'method':method,'params':params or {}})
    async def open(self):
        return await self.call('open', {'host':'proxy.invalid','port':6053,'encryptionKey':base64.b64encode(bytes([1])*32).decode(),'address':'AA:BB:CC:DD:EE:FF','addressType':0,'services':[S],'timeoutMs':500})
    async def test_explicit_open_preserves_identity_bytes_response_and_early_notifications(self):
        self.assertEqual(self.connects, 0)
        await self.open()
        self.assertEqual(await self.call('discover'), [REF])
        self.assertEqual(await self.call('read', {'ref':REF}), 'AP+A')
        await self.call('write', {'ref':REF,'data':'AP+A','withResponse':False})
        self.assertEqual(self.ble.writes, [(b'\x00\xff\x80', False)])
        await self.call('subscribe', {'ref':REF})
        self.assertEqual(self.events, [{'event':'notification','epoch':1,'ref':REF,'data':'Cf8='}])
        callback=self.ble.notify
        await self.call('disconnect')
        callback(b'late')
        self.assertTrue(self.ble.closed)
        self.assertEqual(len(self.events), 1)
    async def test_wrong_service_stale_epoch_and_oversize_write_never_reach_gatt(self):
        await self.open()
        with self.assertRaises(ValueError):
            await self.call('write', {'ref':{'service':C,'characteristic':C},'data':'AQ==','withResponse':True})
        with self.assertRaises(ValueError):
            await self.call('write', {'ref':REF,'data':'AQ==','withResponse':True}, epoch=0)
        with self.assertRaises(ValueError):
            await self.call('write', {'ref':REF,'data':base64.b64encode(bytes(21)).decode(),'withResponse':True})
        self.assertEqual(self.ble.writes, [])
    async def test_loss_is_terminal_and_never_reconnects(self):
        await self.open()
        self.on_loss()
        with self.assertRaises(ValueError): await self.call('read', {'ref':REF})
        self.assertEqual(self.connects,1)
        self.assertEqual(self.events,[{'event':'disconnected','epoch':1}])
        await self.adapter.close()
    async def test_missing_service_rejects_open_and_closes_client(self):
        with self.assertRaises(ValueError):
            await self.call('open', {'host':'proxy.invalid','port':6053,'encryptionKey':base64.b64encode(bytes([1])*32).decode(),'address':'AA:BB:CC:DD:EE:FF','services':[C],'timeoutMs':500})
        self.assertTrue(self.ble.closed)

if __name__ == '__main__': unittest.main()
