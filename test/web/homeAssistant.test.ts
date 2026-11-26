import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantTransport } from '../../web/homeAssistantTransport.ts';

function fixture() {
    const sent: any[] = [];
    const listeners = new Set<(event: any) => void>();
    const parent = { postMessage: (message: unknown, origin: string) => sent.push({ message, origin }) };
    const host = {
        parent,
        location: { origin: 'https://home.test' },
        addEventListener: (_type: string, fn: any) => listeners.add(fn),
        removeEventListener: (_type: string, fn: any) => listeners.delete(fn),
    };
    const transport = createHomeAssistantTransport(host as any);
    return {
        sent,
        parent,
        transport,
        emit: (data: any, source: any = parent, origin = 'https://home.test') => {
            for (const listener of listeners) listener({ data, source, origin });
        },
    };
}
test('HA bridge sends semantic requests only to same-origin parent and rejects foreign replies', async () => {
    const f = fixture();
    const request = f.transport.fetch('https://home.test/mech/api/v1/droids');
    const message = f.sent[0].message;
    assert.equal(f.sent[0].origin, 'https://home.test');
    assert.deepEqual(message.request, { path: 'droids', method: 'GET' });
    let resolved = false;
    void request.then(() => {
        resolved = true;
    });
    f.emit({ type: 'mech:response', id: message.id, response: { status: 200, body: { wrong: true } } }, {}, 'https://home.test');
    f.emit({ type: 'mech:response', id: message.id, response: { status: 200, body: { wrong: true } } }, f.parent, 'https://evil.test');
    await Promise.resolve();
    assert.equal(resolved, false);
    f.emit({ type: 'mech:response', id: message.id, response: { status: 200, body: { items: [] } } });
    assert.deepEqual(await (await request).json(), { items: [] });
    f.transport.close();
});
test('HA bridge preserves operation idempotency and errors without API credentials', async () => {
    const f = fixture();
    const request = f.transport.fetch('https://home.test/mech/api/v1/droids/r2/operations', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'stable' },
        body: JSON.stringify({ action: 'activity.stop', parameters: {} }),
    });
    const message = f.sent[0].message;
    assert.deepEqual(message.request, {
        path: 'droids/r2/operations',
        method: 'POST',
        key: 'stable',
        body: { action: 'activity.stop', parameters: {} },
    });
    assert.equal(JSON.stringify(message).includes('token'), false);
    f.emit({ type: 'mech:response', id: message.id, response: { status: 409, body: { error: { message: 'STOP failed' } } } });
    const response = await request;
    assert.equal(response.status, 409);
    assert.equal(response.ok, false);
    f.transport.close();
});
test('HA bridge rejects cross-origin API paths and pending calls on teardown', async () => {
    const f = fixture();
    await assert.rejects(f.transport.fetch('https://evil.test/mech/api/v1/droids'), /origin|path/i);
    const request = f.transport.fetch('https://home.test/mech/api/v1/session');
    f.transport.close();
    await assert.rejects(request, /closed/i);
    assert.equal(f.sent.length, 1);
});
test('HA bridge closes polling subscriptions and does not restart them after close', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const f = fixture();
    let changes = 0;
    const unsubscribe = f.transport.subscribeChanges(() => {
        changes++;
    });
    t.mock.timers.tick(1000);
    assert.equal(changes, 1);
    f.transport.close();
    t.mock.timers.tick(1000);
    assert.equal(changes, 1);
    f.transport.subscribeChanges(() => {
        changes++;
    });
    t.mock.timers.tick(1000);
    assert.equal(changes, 1);
    unsubscribe();
});
test('HA bridge rejects empty-body HTTP replies without throwing from its message listener', async () => {
    const f = fixture();
    const request = f.transport.fetch('https://home.test/mech/api/v1/session');
    try {
        assert.doesNotThrow(() => f.emit({ type: 'mech:response', id: f.sent[0].message.id, response: { status: 204, body: {} } }));
        const response = await request;
        assert.equal(response.status, 204);
        assert.equal(await response.text(), '');
    } finally {
        f.transport.close();
    }
});
