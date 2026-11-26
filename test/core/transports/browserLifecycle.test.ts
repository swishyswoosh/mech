import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBleTransport } from '../../../core/transports/webBluetooth.ts';

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

// Only the browser's native GATT boundary is simulated. The transport, queue,
// packet splitting, callbacks and teardown are the production implementation.
async function fixture() {
    const ref = { service: 'service', characteristic: 'characteristic' };
    const writes: number[][] = [];
    let writeGate: ReturnType<typeof deferred> | undefined;
    let readGate: ReturnType<typeof deferred> | undefined;
    let startGate: ReturnType<typeof deferred> | undefined;
    let entered = deferred();
    let notifying = false;
    let stops = 0;
    class Characteristic extends EventTarget {
        uuid = ref.characteristic;
        value = new DataView(Uint8Array.of(7).buffer);
        async readValue() {
            entered.resolve();
            await readGate?.promise;
            return this.value;
        }
        async writeValueWithResponse(bytes: Uint8Array) {
            writes.push([...bytes]);
            entered.resolve();
            const gate = writeGate;
            writeGate = undefined;
            await gate?.promise;
        }
        async writeValueWithoutResponse(bytes: Uint8Array) {
            await this.writeValueWithResponse(bytes);
        }
        async startNotifications() {
            entered.resolve();
            await startGate?.promise;
            notifying = true;
            return this;
        }
        async stopNotifications() {
            stops++;
            notifying = false;
            return this;
        }
        emit() {
            if (notifying) this.dispatchEvent(new Event('characteristicvaluechanged'));
        }
    }
    const characteristic = new Characteristic();
    const server = {
        connected: false,
        async connect() { this.connected = true; return this; },
        disconnect() { this.connected = false; },
        async getPrimaryServices() {
            return [{ uuid: ref.service, async getCharacteristics() { return [characteristic]; } }];
        },
    };
    const device = Object.assign(new EventTarget(), { id: 'test', name: 'Test droid', gatt: server });
    const transport = new BrowserBleTransport(device as unknown as BluetoothDevice);
    await transport.discover();
    return {
        ref, transport, writes,
        replacement: () => new BrowserBleTransport(device as unknown as BluetoothDevice),
        connected: () => server.connected,
        emit: () => characteristic.emit(),
        stops: () => stops,
        hold(kind: 'write' | 'read' | 'start') {
            const gate = deferred();
            entered = deferred();
            if (kind === 'write') writeGate = gate;
            if (kind === 'read') readGate = gate;
            if (kind === 'start') startGate = gate;
            return { started: entered.promise, finish: () => gate.resolve() };
        },
    };
}

test('browser STOP interrupts the remaining chunks of an active ordinary write', async () => {
    const f = await fixture();
    const gate = f.hold('write');
    const write = f.transport.write(f.ref, new Uint8Array(45).fill(1), false);
    const rejected = assert.rejects(write, /canceled/i);
    await gate.started;
    const stop = f.transport.emergencyWrite(f.ref, [Uint8Array.of(9)]);
    gate.finish();
    await rejected;
    await stop;
    assert.deepEqual(f.writes, [new Array(20).fill(1), [9]]);
    await f.transport.disconnect();
});

for (const emergency of [false, true]) {
    test(`browser disconnect cancels an active ${emergency ? 'emergency' : 'ordinary'} multipart write`, async () => {
        const f = await fixture();
        const gate = f.hold('write');
        const bytes = new Uint8Array(45).fill(1);
        const write = emergency
            ? f.transport.emergencyWrite(f.ref, [bytes, Uint8Array.of(2)])
            : f.transport.write(f.ref, bytes, true);
        const rejected = assert.rejects(write, /canceled/i);
        await gate.started;
        await f.transport.disconnect();
        gate.finish();
        await rejected;
        assert.deepEqual(f.writes, [new Array(20).fill(1)]);
    });
}

test('browser disconnect rejects a read that returns late', async () => {
    const f = await fixture();
    const gate = f.hold('read');
    const read = f.transport.read(f.ref);
    const rejected = assert.rejects(read, /canceled/i);
    await gate.started;
    await f.transport.disconnect();
    gate.finish();
    await rejected;
});

test('browser disconnect removes a notification listener while native startup is pending', async () => {
    const f = await fixture();
    const gate = f.hold('start');
    let notifications = 0;
    const subscribe = f.transport.subscribe(f.ref, () => { notifications++; });
    const rejected = assert.rejects(subscribe, /canceled/i);
    await gate.started;
    await f.transport.disconnect();
    gate.finish();
    await rejected;
    f.emit();
    assert.equal(notifications, 0);
});

test('browser keeps notifications active until the last distinct subscription ends', async () => {
    const f = await fixture();
    const first: number[] = [];
    const second: number[] = [];
    const off1 = await f.transport.subscribe(f.ref, (bytes) => first.push(bytes[0]));
    const off2 = await f.transport.subscribe(f.ref, (bytes) => second.push(bytes[0]));
    off1();
    await f.transport.read(f.ref);
    f.emit();
    assert.deepEqual(first, []);
    assert.deepEqual(second, [7]);
    assert.equal(f.stops(), 0);
    off2();
    await f.transport.read(f.ref);
    assert.equal(f.stops(), 1);
    await f.transport.disconnect();
});

test('browser repeated old unsubscribe does not stop a later subscription', async () => {
    const f = await fixture();
    const oldOff = await f.transport.subscribe(f.ref, () => {});
    oldOff();
    await f.transport.read(f.ref);
    let notifications = 0;
    await f.transport.subscribe(f.ref, () => { notifications++; });
    oldOff();
    await f.transport.read(f.ref);
    f.emit();
    assert.equal(notifications, 1);
    assert.equal(f.stops(), 1);
    await f.transport.disconnect();
});

test('browser STOP retains established notification subscribers', async () => {
    const f = await fixture();
    const received: number[] = [];
    await f.transport.subscribe(f.ref, (bytes) => received.push(bytes[0]));
    await f.transport.emergencyWrite(f.ref, [Uint8Array.of(9)]);
    f.emit();
    assert.deepEqual(received, [7]);
    assert.equal(f.stops(), 0);
    await f.transport.disconnect();
    f.emit();
    assert.deepEqual(received, [7]);
});

test('browser STOP cancels pending notification startup without stopping a later subscription', async () => {
    const f = await fixture();
    const gate = f.hold('start');
    const oldValues: number[] = [];
    const newValues: number[] = [];
    const subscribe = f.transport.subscribe(f.ref, (bytes) => oldValues.push(bytes[0]));
    const rejected = assert.rejects(subscribe, /canceled/i);
    await gate.started;
    const stop = f.transport.emergencyWrite(f.ref, [Uint8Array.of(9)]);
    const replacement = f.transport.subscribe(f.ref, (bytes) => newValues.push(bytes[0]));
    gate.finish();
    await rejected;
    await stop;
    await replacement;
    await f.transport.read(f.ref);
    f.emit();
    assert.deepEqual(oldValues, []);
    assert.deepEqual(newValues, [7]);
    assert.deepEqual(f.writes, [[9]]);
    assert.equal(f.stops(), 0);
    await f.transport.disconnect();
});

test('browser repeated old disconnect cannot close a replacement transport for the same device', async () => {
    const f = await fixture();
    await f.transport.disconnect();
    const replacement = f.replacement();
    await replacement.discover();
    assert.equal(f.connected(), true);
    await f.transport.disconnect();
    assert.equal(f.connected(), true);
    assert.deepEqual([...await replacement.read(f.ref)], [7]);
    await replacement.disconnect();
});
