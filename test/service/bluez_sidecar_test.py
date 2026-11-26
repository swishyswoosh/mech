"""Tests the Linux adapter at its native Bluetooth boundary; never uses a radio."""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from espHome_sidecar_test import FakeBle, S, C, REF

path = pathlib.Path(__file__).resolve().parents[2] / 'service/bluez/sidecar.py'
spec = importlib.util.spec_from_file_location('bluez_sidecar', path)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)

class BluezTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_connect_adapter_notifications_loss_and_cleanup(self):
        calls = []
        device = SimpleNamespace(address='AA:BB:CC:DD:EE:FF')
        class Scanner:
            @staticmethod
            async def find_device_by_address(address, **kw):
                calls.append(('scan', address, kw['bluez']['adapter']))
                return device
        class Client(FakeBle):
            def __init__(self, found, **kw):
                super().__init__()
                self.is_connected = False
                self.lost = kw['disconnected_callback']
                calls.append(('client', found, kw['bluez']['adapter']))
            async def connect(self): self.is_connected = True
            async def disconnect(self):
                self.is_connected = False
                calls.append(('disconnect',))
                self.lost(self)
            async def start_notify(self, characteristic, callback):
                callback(characteristic, bytearray([9, 255]))
        events = []
        with patch.object(sys, 'platform', 'linux'), patch.dict(sys.modules, {'bleak':SimpleNamespace(BleakClient=Client, BleakScanner=Scanner)}):
            adapter = sidecar.Adapter(events.append)
            self.assertEqual(calls, [])
            await adapter.handle({'id':1,'epoch':7,'method':'open','params':{'address':device.address,'adapter':'hci1','services':[S]}})
            self.assertEqual(calls[:2], [('scan',device.address,'hci1'),('client',device,'hci1')])
            await adapter.handle({'id':2,'epoch':7,'method':'subscribe','params':{'ref':REF}})
            self.assertEqual(events,[{'event':'notification','epoch':7,'ref':REF,'data':'Cf8='}])
            adapter.client.client.lost(adapter.client.client)
            with self.assertRaises(ValueError):
                await adapter.handle({'id':3,'epoch':7,'method':'read','params':{'ref':REF}})
            await adapter.close()
            self.assertEqual(len([x for x in calls if x[0]=='scan']),1)
            self.assertEqual(calls[-1],('disconnect',))

    async def test_partial_connection_failure_closes_native_client(self):
        closed=[]
        class Scanner:
            @staticmethod
            async def find_device_by_address(*a,**kw): return object()
        class Client:
            def __init__(self,*a,**kw): pass
            async def connect(self): raise RuntimeError('native failure')
            async def disconnect(self): closed.append(True)
        with patch.object(sys, 'platform', 'linux'), patch.dict(sys.modules, {'bleak':SimpleNamespace(BleakClient=Client,BleakScanner=Scanner)}):
            with self.assertRaises(RuntimeError):
                await sidecar.connect_backend({'address':'AA:BB:CC:DD:EE:FF'},lambda:None)
        self.assertEqual(closed,[True])

    def test_invalid_configuration_never_reaches_native_import(self):
        for params in [{'address':'bad'}, {'address':'AA:BB:CC:DD:EE:FF','adapter':'../hci0'}, {'address':'AA:BB:CC:DD:EE:FF','timeoutMs':0}]:
            with self.assertRaises(ValueError): sidecar.validate_config(params)

    async def test_non_linux_connect_fails_without_discovery(self):
        with patch.object(sys, 'platform', 'darwin'):
            with self.assertRaisesRegex(RuntimeError, 'linux_required'):
                await sidecar.connect_backend({'address':'AA:BB:CC:DD:EE:FF'},lambda:None)
