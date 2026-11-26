import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopBleTransport } from '../../../core/transports/desktopBridge.ts';

function fixture(t: any, initialEvent = 'ready') {
    const streams: Events[] = [];
    const requests: string[] = [];
    let holdClose = false;
    let closeResponse: ((value: Response) => void) | undefined;
    let readResponse: ((value: Response) => void) | undefined;
    class Events {
        onmessage: ((event: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        closed = false;
        constructor(_url: string) {
            streams.push(this);
            queueMicrotask(() => this.emit({ event: initialEvent }));
        }
        emit(message: unknown) {
            this.onmessage?.({ data: JSON.stringify(message) });
        }
        close() {
            this.closed = true;
        }
    }
    t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
        if (String(url).endsWith('/session')) return Response.json({ session: 'test' });
        if (String(url).endsWith('/status')) return Response.json({ available: true });
        const { method } = JSON.parse(options.body);
        requests.push(method);
        if (method === 'disconnect' && holdClose)
            return await new Promise<Response>((resolve) => {
                closeResponse = resolve;
            });
        if (method === 'read')
            return await new Promise<Response>((resolve) => {
                readResponse = resolve;
            });
        return Response.json({ result: method === 'discover' ? [] : null });
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: Events });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'EventSource', original);
        else Reflect.deleteProperty(globalThis, 'EventSource');
    });
    return {
        streams,
        requests,
        holdClose: () => {
            holdClose = true;
        },
        finishClose: () => closeResponse!(Response.json({ result: null })),
        finishRead: () => readResponse!(Response.json({ result: 'AQ==' })),
    };
}
test('desktop in-flight reads reject a late success after event-stream loss', async (t) => {
    const f = fixture(t);
    let lost = 0;
    const transport = await DesktopBleTransport.attach(() => {
        lost++;
    });
    const read = transport.read({ service: 's', characteristic: 'c' });
    await Promise.resolve();
    f.streams[0].emit({ event: 'disconnected' });
    f.finishRead();
    await assert.rejects(read, /closed|lost|canceled/i);
    assert.equal(lost, 1);
    assert.equal(f.streams[0].closed, true);
});
test('desktop final status lookup cannot return a transport lost during attach', async (t) => {
    const f = fixture(t);
    let finishStatus!: () => void;
    let statusStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        statusStarted = resolve;
    });
    const original = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
        if (String(url).endsWith('/status')) {
            statusStarted();
            await new Promise<void>((resolve) => {
                finishStatus = resolve;
            });
            return Response.json({ available: true });
        }
        return original(url, init);
    });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'localhost' } });
    t.after(() => Reflect.deleteProperty(globalThis, 'location'));
    const attach = DesktopBleTransport.attach(() => {});
    await started;
    f.streams[0].emit({ event: 'disconnected' });
    finishStatus();
    await assert.rejects(attach, /closed|lost|canceled/i);
});
test('desktop shares notifications until the final distinct listener unsubscribes', async (t) => {
    const f = fixture(t);
    const transport = await DesktopBleTransport.attach(() => {});
    const ref = { service: 's', characteristic: 'c' };
    const first: number[] = [];
    const second: number[] = [];
    try {
        const off1 = await transport.subscribe(ref, (bytes) => first.push(bytes[0]));
        const off2 = await transport.subscribe(ref, (bytes) => second.push(bytes[0]));
        f.streams[0].emit({ event: 'notification', key: 's/c', data: 'AQ==' });
        assert.deepEqual(first, [1]);
        assert.deepEqual(second, [1]);
        off1();
        await transport.discover();
        assert.deepEqual(f.requests, ['discover', 'subscribe']);
        off2();
        await transport.discover();
        assert.deepEqual(f.requests, ['discover', 'subscribe', 'unsubscribe']);
    } finally {
        await transport.disconnect();
    }
});
test('desktop stale notification cleanup does not remove a later subscription', async (t) => {
    const f = fixture(t);
    const transport = await DesktopBleTransport.attach(() => {});
    const ref = { service: 's', characteristic: 'c' };
    let notifications = 0;
    const listener = () => {
        notifications++;
    };
    try {
        const oldOff = await transport.subscribe(ref, listener);
        oldOff();
        await transport.discover();
        const off = await transport.subscribe(ref, listener);
        oldOff();
        await transport.discover();
        f.streams[0].emit({ event: 'notification', key: 's/c', data: 'AQ==' });
        assert.equal(notifications, 1);
        off();
    } finally {
        await transport.disconnect();
    }
});

test('desktop repeated disconnect waits for the existing native cleanup', async (t) => {
    const f = fixture(t);
    const transport = await DesktopBleTransport.attach(() => {});
    f.holdClose();
    const close = transport.disconnect();
    let repeatedFinished = false;
    const repeated = transport.disconnect().then(() => {
        repeatedFinished = true;
    });
    try {
        await Promise.resolve();
        assert.equal(repeatedFinished, false);
    } finally {
        f.finishClose();
        await close;
        await repeated;
    }
});
test('desktop attach rejects immediately if disconnected arrives before ready', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t, 'disconnected');
    const attach = DesktopBleTransport.attach(() => {});
    const outcome = attach.then(
        () => 'connected',
        () => 'rejected',
    );
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(await Promise.race([outcome, Promise.resolve('pending')]), 'rejected');
        assert.equal(f.streams[0].closed, true);
    } finally {
        t.mock.timers.tick(5000);
        await outcome;
    }
});
