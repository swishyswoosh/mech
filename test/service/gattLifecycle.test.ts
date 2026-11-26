import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createBluezFactory } from '../../service/bluezTransport.ts';

test('GATT disconnect immediately fences new work and repeated closes retain the ownership wait', async () => {
    const factory = createBluezFactory({
        address: 'AA:BB:CC:DD:EE:FF',
        droidId: 'r2',
        pythonCommand: process.execPath,
        pythonArgs: [fileURLToPath(new URL('./gattLifecycleFake.mjs', import.meta.url))],
    });
    const request = { services: [], check() {}, selection() {}, onDisconnect() {} };
    const { transport } = await factory.open(request);
    try {
        const close = transport.disconnect();
        const bothClosed = Promise.all([close, transport.disconnect()]);
        void bothClosed.catch(() => {});
        await assert.rejects(transport.read({ service: 's', characteristic: 'c' }), /closed|closing|canceled/i);
        await assert.rejects(factory.open(request), /active/i);
        await bothClosed;
        const next = await factory.open(request);
        await next.transport.disconnect();
    } finally {
        factory.cancel!();
    }
});
test('GATT stale cleanup cannot unsubscribe the same callback after a later subscription', async () => {
    const factory = createBluezFactory({
        address: 'AA:BB:CC:DD:EE:FF',
        adapter: 'hci1',
        droidId: 'r2',
        pythonCommand: process.execPath,
        pythonArgs: [fileURLToPath(new URL('./bluezFake.mjs', import.meta.url))],
    });
    const { transport } = await factory.open({ services: [], check() {}, selection() {}, onDisconnect() {} });
    const ref = { service: 'service-one', characteristic: 'char-one' };
    let notifications = 0;
    const listener = () => {
        notifications++;
    };
    try {
        const oldOff = await transport.subscribe(ref, listener);
        oldOff();
        await transport.read(ref);
        const off = await transport.subscribe(ref, listener);
        oldOff();
        await transport.write(ref, Uint8Array.of(1), true);
        assert.equal(notifications, 1);
        off();
    } finally {
        await transport.disconnect();
    }
});

test('GATT factory rejects an open acknowledgment followed immediately by loss', async () => {
    const factory = createBluezFactory({
        address: 'AA:BB:CC:DD:EE:FF',
        droidId: 'r2',
        pythonCommand: process.execPath,
        pythonArgs: [fileURLToPath(new URL('./gattLifecycleFake.mjs', import.meta.url)), 'lose-open'],
    });
    let losses = 0;
    try {
        await assert.rejects(
            factory.open({
                services: [],
                check() {},
                selection() {},
                onDisconnect() {
                    losses++;
                },
            }),
            /closed|lost|canceled/i,
        );
        assert.equal(losses, 1);
    } finally {
        factory.cancel!();
    }
});
