import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Authentication, HttpError, type TokenGrant } from '../../service/auth.ts';

const origin = 'https://controller.test';
function fixture() {
    const grant: TokenGrant = {
        id: 'operator',
        sha256: createHash('sha256').update('secret').digest('hex'),
        scopes: ['read', 'operate', 'stop'],
        droids: ['r2'],
    };
    return { grant, auth: new Authentication([grant], [origin], '/mech/') };
}
const req = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage;
const error = (status: number, code: string) => (value: unknown) =>
    value instanceof HttpError && value.status === status && value.code === code;

test('cookie mutation requires the configured origin and CSRF; logout invalidates an existing authorization', () => {
    const { auth } = fixture();
    const login = auth.login(req({ origin }), 'secret');
    const headers = { origin, cookie: `other=x; mech_session=${login.id}`, 'x-csrf-token': login.csrf };
    const authorized = auth.authenticate(req(headers), true);
    assert.equal(authorized.valid(), true);
    assert.throws(() => auth.authenticate(req({ ...headers, 'x-csrf-token': 'wrong' }), true), error(403, 'csrf_required'));
    assert.throws(() => auth.authenticate(req({ ...headers, origin: undefined }), true), error(403, 'origin_denied'));
    assert.throws(() => auth.authenticate(req({ ...headers, origin: 'https://other.test' }), true), error(403, 'origin_denied'));
    auth.logout(req(headers));
    assert.equal(authorized.valid(), false);
    assert.throws(() => auth.authenticate(req(headers)), error(401, 'unauthenticated'));
});
test('cookie authorization expires at the deadline and revocation invalidates retained bearer authorization', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const { auth, grant } = fixture();
    const login = auth.login(req({ origin }), 'secret');
    const cookie = auth.authenticate(req({ origin, cookie: `mech_session=${login.id}` }));
    const bearer = auth.authenticate(req({ authorization: 'Bearer secret' }), true);
    t.mock.timers.tick(900000);
    assert.equal(cookie.valid(), false);
    assert.equal(bearer.valid(), true);
    assert.throws(() => auth.authenticate(req({ cookie: `mech_session=${login.id}` })), error(401, 'unauthenticated'));
    grant.revoked = true;
    assert.equal(bearer.valid(), false);
    assert.throws(() => auth.authenticate(req({ authorization: 'Bearer secret' })), error(401, 'unauthenticated'));
});
test('grant boundaries hide unenrolled droids and require STOP scope for operator configuration', () => {
    const { auth, grant } = fixture();
    auth.require(grant, 'operate', 'r2');
    assert.throws(() => auth.require(grant, 'operate', 'other'), error(404, 'not_found'));
    assert.throws(() => auth.require(grant, 'admin', 'r2'), error(403, 'scope_denied'));
    assert.throws(() => new Authentication([{ ...grant, scopes: ['operate'] }], [origin], ''), /STOP/);
    assert.throws(() => new Authentication([grant], [origin + '/path'], ''), /exact/);
    assert.equal(auth.cookie('', true), 'mech_session=; Path=/mech/; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
});
