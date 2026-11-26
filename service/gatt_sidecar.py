"""Bounded private GATT IPC shared by Linux BlueZ and ESPHome adapters."""
import asyncio
import base64
import contextlib
import json
import logging
import sys
import signal
import uuid

MAX_LINE = 65536

async def finish_cleanup(cleanup):
    """Finish the bounded native close before propagating caller cancellation."""
    task = asyncio.create_task(cleanup())
    canceled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            if task.cancelled():
                raise
            canceled = True
    if canceled:
        raise asyncio.CancelledError
    return result


class Adapter:
    def __init__(self, emit, connector, validator):
        self.emit = emit
        self.connector = connector
        self.validator = validator
        self.client = None
        self.cleanup = None
        self.epoch = None
        self.active = False
        self.used = False
        self.refs = {}
        self.subscriptions = set()

    def lost(self):
        if self.active:
            self.active = False
            self.subscriptions.clear()
            self.emit({'event': 'disconnected', 'epoch': self.epoch})

    async def close(self):
        self.active = False
        self.subscriptions.clear()
        cleanup, self.cleanup = self.cleanup, None
        if cleanup is not None:
            await finish_cleanup(cleanup)
        self.client = None
        self.refs.clear()

    def reference(self, params):
        ref = params.get('ref', {})
        key = (str(uuid.UUID(ref['service'])), str(uuid.UUID(ref['characteristic'])))
        if key not in self.refs:
            raise ValueError('unknown_characteristic')
        return key, self.refs[key]

    async def handle(self, request):
        if not isinstance(request, dict) or not isinstance(request.get('id'), int) or not isinstance(request.get('epoch'), int):
            raise ValueError('invalid_request')
        params = request.get('params', {})
        if not isinstance(params, dict):
            raise ValueError('invalid_request')
        method = request.get('method')
        if method == 'open':
            if self.used:
                raise ValueError('connection_already_used')
            self.validator(params)
            self.used = True
            self.epoch = request['epoch']
            self.active = True
            try:
                self.client, self.cleanup = await self.connector(params, self.lost)
                if not self.active:
                    raise ValueError('connection_lost')
                for service in self.client.services:
                    for characteristic in service.characteristics:
                        key = (str(uuid.UUID(service.uuid)), str(uuid.UUID(characteristic.uuid)))
                        if key in self.refs:
                            raise ValueError('ambiguous_characteristic')
                        self.refs[key] = characteristic
                available = {key[0] for key in self.refs}
                if not {str(uuid.UUID(service)) for service in params.get('services', [])} <= available:
                    raise ValueError('required_service_missing')
                return {'mtu': self.client.mtu_size}
            except BaseException:
                await self.close()
                raise
        if request['epoch'] != self.epoch:
            raise ValueError('stale_epoch')
        if method == 'disconnect':
            await self.close()
            return None
        if not self.active or self.client is None:
            raise ValueError('connection_closed')
        if method == 'discover':
            return [{'service': service, 'characteristic': characteristic} for service, characteristic in self.refs]
        key, characteristic = self.reference(params)
        if method == 'read':
            return base64.b64encode(await self.client.read_gatt_char(characteristic)).decode('ascii')
        if method == 'write':
            data = base64.b64decode(params['data'], validate=True)
            # Shared core chunks protocol frames. Rejecting oversized requests
            # preserves its ATT write boundaries without splitting characteristic values.
            if not data or len(data) > self.client.mtu_size - 3 or type(params.get('withResponse')) is not bool:
                raise ValueError('invalid_write')
            await self.client.write_gatt_char(characteristic, data, response=params['withResponse'])
        elif method == 'subscribe':
            if key not in self.subscriptions:
                self.subscriptions.add(key)
                epoch = self.epoch
                def notification(data):
                    if self.active and epoch == self.epoch and key in self.subscriptions:
                        self.emit({'event': 'notification', 'epoch': epoch,
                                   'ref': {'service': key[0], 'characteristic': key[1]},
                                   'data': base64.b64encode(data).decode('ascii')})
                try:
                    # Backend returns only after delivery registration and CCCD write.
                    await self.client.start_notify(characteristic, notification)
                except BaseException:
                    self.subscriptions.discard(key)
                    raise
        elif method == 'unsubscribe':
            if key in self.subscriptions:
                self.subscriptions.remove(key)
                await self.client.stop_notify(characteristic)
        else:
            raise ValueError('unknown_method')
        return None


def emit(message):
    line = json.dumps(message, separators=(',', ':'))
    if len(line) > MAX_LINE:
        raise ValueError('response_too_large')
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


async def run(adapter_factory):
    # No dependency log content or tracebacks cross the private protocol boundary.
    logging.disable(logging.CRITICAL)
    adapter = adapter_factory(emit)
    loop = asyncio.get_running_loop()
    task = asyncio.current_task()
    shutdown_requested = False
    def request_shutdown():
        nonlocal shutdown_requested
        if not shutdown_requested:
            shutdown_requested = True
            task.cancel()
    loop.add_signal_handler(signal.SIGTERM, request_shutdown)
    reader = asyncio.StreamReader(limit=MAX_LINE)
    protocol = asyncio.StreamReaderProtocol(reader)
    pipe, _ = await asyncio.get_running_loop().connect_read_pipe(lambda: protocol, sys.stdin.buffer)
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            if len(line) > MAX_LINE:
                break
            request = None
            try:
                request = json.loads(line)
                timeout = request.get('params', {}).get('timeoutMs', 5000) if request.get('method') == 'open' else 5000
                if not isinstance(timeout, (int, float)) or not 0 < timeout <= 120000:
                    raise ValueError('invalid_request')
                result = await asyncio.wait_for(adapter.handle(request), timeout / 1000)
                emit({'id': request['id'], 'epoch': request['epoch'], 'result': result})
                if request['method'] == 'disconnect':
                    break
            except (ValueError, KeyError, TypeError, AttributeError):
                if isinstance(request, dict):
                    emit({'id': request.get('id'), 'epoch': request.get('epoch'),
                          'error': {'code': 'invalid_request', 'message': 'Invalid GATT request'}})
                else:
                    break
            except Exception:
                if isinstance(request, dict):
                    emit({'id': request.get('id'), 'epoch': request.get('epoch'),
                          'error': {'code': 'connection_unavailable', 'message': 'GATT operation failed'}})
                adapter.lost()
                break
    except asyncio.CancelledError:
        pass
    finally:
        # Parent may request termination in response to the disconnect event.
        # Cleanup must survive that request and repeated termination signals.
        loop.add_signal_handler(signal.SIGTERM, lambda: None)
        pipe.close()
        try:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(adapter.close(), 7)
        finally:
            loop.remove_signal_handler(signal.SIGTERM)
