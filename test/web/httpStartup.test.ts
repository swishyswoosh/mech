import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteSession } from '../../web/remoteSession.ts';
import { createHomeAssistantTransport } from '../../web/homeAssistantTransport.ts';

test('HTTP Home Assistant startup works without secure-context randomUUID', async (t) => {
  const secureCrypto = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto) } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  const listeners = new Set<(event: any) => void>();
  const ids: string[] = [];
  const origin = 'http://home.test:8123';
  const parent = { postMessage(message: any, target: string) {
    assert.equal(target, origin);
    ids.push(message.id);
    const body = message.request.path === 'session'
      ? { authenticated: true, csrf_token: 'test' } : { items: [] };
    queueMicrotask(() => listeners.forEach(listener => listener({
      origin, source: parent, data: { type: 'mech:response', id: message.id, response: { status: 200, body } },
    })));
  } };
  const bridge = createHomeAssistantTransport({ parent, location: { origin },
    addEventListener: (_: string, fn: any) => listeners.add(fn),
    removeEventListener: (_: string, fn: any) => listeners.delete(fn),
  } as any);
  t.after(() => bridge.close());
  const session = new RemoteSession({ base: `${origin}/mech/api/v1/`, fetch: bridge.fetch });
  t.after(() => session.dispose());
  await session.initialize();
  assert.deepEqual(await session.authorizedDroids(), []);
  assert.match(session.clientId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(ids.length >= 2);
  assert.equal(new Set([session.clientId, ...ids]).size, ids.length + 1);
});
