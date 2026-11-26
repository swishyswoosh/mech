import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { OperationStore } from './store.ts';
import type { Operation } from './store.ts';
import { Authentication, HttpError } from './auth.ts';
import type { TokenGrant } from './auth.ts';
import { privateRuntimeKey } from './preferences.ts';
import { ServiceEvents } from './events.ts';
import { object, keys, text, operationBody } from './validation.ts';
import type { SessionSnapshot } from '../app/session/types.ts';
export interface Runtime {
    snapshot(): SessionSnapshot;
    subscribe(fn: (snapshot: SessionSnapshot) => void): () => void;
    catalogs(kind: string): {
        items: any[];
    };
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    stop(): Promise<void>;
    execute(action: string, parameters: Record<string, unknown>): Promise<{
        state: string;
        confirmation: string;
        evidence?: unknown;
    }>;
    prepare?(action: string, parameters: Record<string, unknown>): {
        parameters: Record<string, unknown>;
        execute: () => Promise<{
            state: string;
            confirmation: string;
            evidence?: unknown;
        }>;
    };
    busy(): boolean;
    dispose(): Promise<void>;
}
export type ServiceOptions = {
    database: string;
    tokens: TokenGrant[];
    droids: {
        id: string;
        name: string;
        runtime: Runtime;
        automationWake?: boolean;
    }[];
    origins: string[];
    prefix?: string;
    frameAncestors?: string[];
    secureCookies?: boolean;
    crossSiteCookies?: boolean;
    staticDirectory?: string;
    store?: OperationStore;
};
export function createService(options: ServiceOptions) {
    const prefix = (options.prefix ?? '').replace(/\/$/, '');
    if (prefix && (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix)))
        throw Error('Invalid ingress prefix');
    const auth = new Authentication(options.tokens, options.origins, prefix),
        store = options.store ?? new OperationStore(options.database),
        events = new ServiceEvents(),
        instance = store.instanceId();
    if (options.crossSiteCookies && !options.secureCookies)
        throw Error('Cross-site cookies require HTTPS secureCookies');
    for (const id of store.revokedTokens())
        for (const token of options.tokens)
            if (token.id === id)
                token.revoked = true;
    const droids = new Map(options.droids.map(d => [d.id, d]));
    if (droids.size !== options.droids.length)
        throw Error('Duplicate enrolled droid ID');
    const revisions = new Map<string, number>(),
        observed = new Map<string, string>(),
        powerTransitions = new Set<string>(),
        generations = new Map<string, number>(),
        pending = new Map<string, string>(),
        sources = new Map<string, string>(),
        stopWork = new Map<string, Promise<void>>(),
        memoryOps = new Map<string, Operation>(),
        workers = new Set<Promise<void>>();
    const clients = new Map<string, {
        principal: TokenGrant;
        droid: string;
        expires: number;
        valid: () => boolean;
    }>();
    let closing = false;
    function friendlyName(id: string, fallback: string) {
        try {
            return store.preferences(id).values[`droidName.v1.${encodeURIComponent(id)}`]?.trim() || fallback;
        }
        catch {
            return fallback;
        }
    }
    function snapshot(id: string) {
        const d = droids.get(id)!,
            session = d.runtime.snapshot(),
            state = session.state,
            connected = ['ready', 'paused', 'failed', 'sleep-requested', 'checking-compatibility'].includes(session.connection.state);
        return {
            droid_id: id,
            name: friendlyName(id, session.connection.droidName || d.name),
            connection: connected ? 'connected' : ['scanning', 'connecting', 'discovering', 'initializing', 'awaiting-restart'].includes(session.connection.state) ? 'connecting' : 'disconnected',
            power: state === 'sleeping' ? 'asleep' : state === 'sleep-requested' ? 'sleep_requested' : connected ? 'awake' : 'unknown',
            control: state === 'failed' ? 'failed' : stopWork.has(id) || powerTransitions.has(id) ? 'stopping' : pending.has(id) || d.runtime.busy() ? 'busy' : 'ready',
            battery_voltage: connected ? (session.cockpitReadings?.['battery.volts']?.value ?? null) : null,
            revision: revisions.get(id) ?? 0,
            observed_at: observed.get(id) ?? null,
            session
        };
    }
    const unsub = options.droids.map(d => d.runtime.subscribe(() => {
        revisions.set(d.id, (revisions.get(d.id) ?? 0) + 1);
        observed.set(d.id, new Date().toISOString());
        events.emit('snapshot', snapshot(d.id), d.id);
    }));
    function update(id: string, patch: Record<string, unknown>) {
        let op: Operation;
        try {
            op = store.update(id, patch);
        }
        catch {
            const prior = memoryOps.get(id);
            if (!prior)
                throw new HttpError(503, 'persistence_unavailable');
            op = {
                ...prior,
                ...patch,
                revision: prior.revision + 1,
                durability: 'unavailable'
            };
        }
        memoryOps.set(id, op);
        events.emit('operation.updated', publicOp(op), op.droid_id);
        return op;
    }
    function publicOp(op: Operation) {
        const { principal, ...data } = op;
        return data;
    }
    function getOp(id: string) {
        const memory = memoryOps.get(id);
        try {
            const saved = store.get(id);
            return memory && (!saved || memory.revision > saved.revision) ? memory : saved;
        }
        catch {
            return memory;
        }
    }
    function stop(id: string) {
        const existing = stopWork.get(id);
        if (existing)
            return existing;
        generations.set(id, (generations.get(id) ?? 0) + 1);
        const d = droids.get(id)!;
        const run = Promise.resolve().then(async () => {
            if (['connected', 'connecting'].includes(snapshot(id).connection) || pending.has(id))
                await d.runtime.stop();
            sources.delete(id);
        });
        stopWork.set(id, run);
        void run.then(() => {
            stopWork.delete(id);
            events.emit('snapshot', snapshot(id), id);
        }, () => {
            stopWork.delete(id);
            events.emit('snapshot', snapshot(id), id);
        });
        return run;
    }
    const buckets = new Map<string, {
        tokens: number;
        at: number;
    }>();
    function take(grant: TokenGrant, id: string) {
        const now = performance.now(),
            key = grant.id + ':' + id,
            b = buckets.get(key) ?? { tokens: 20, at: now };
        b.tokens = Math.min(20, b.tokens + (now - b.at) / 100);
        b.at = now;
        if (b.tokens < 1) {
            buckets.set(key, b);
            return false;
        }
        b.tokens--;
        buckets.set(key, b);
        return true;
    }
    const timer = setInterval(() => {
        for (const [key, c] of clients)
            if (c.expires < Date.now() || !c.valid()) {
                clients.delete(key);
                void stop(c.droid).catch(() => { });
            }
    }, 500);
    timer.unref();
    function scoped(grant: TokenGrant, id: string, scope: string | null = 'read') {
        if (scope)
            auth.require(grant, scope, id);
        else if (!auth.allowed(grant, id))
            throw new HttpError(404, 'not_found');
        const d = droids.get(id);
        if (!d)
            throw new HttpError(404, 'not_found');
        return d;
    }
    function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(data));
    }
    async function body(req: IncomingMessage) {
        const parts: Buffer[] = [];
        let size = 0;
        if (!req.headers['content-type']?.startsWith('application/json'))
            throw new HttpError(415, 'json_required');
        for await (const chunk of req) {
            size += chunk.length;
            if (size > 262144)
                throw new HttpError(413, 'body_too_large');
            parts.push(Buffer.from(chunk));
        }
        try {
            return object(JSON.parse(Buffer.concat(parts).toString('utf8')));
        }
        catch (e) {
            if (e instanceof HttpError)
                throw e;
            throw new HttpError(400, 'invalid_json');
        }
    }
    async function run(op: Operation, request: ReturnType<typeof operationBody>, grant: TokenGrant, started: number, generation: number, prepared?: ReturnType<NonNullable<Runtime['prepare']>>) {
        const id = op.droid_id, d = droids.get(id)!, { action, parameters, policy } = request;
        const check = () => {
            if (closing || grant.revoked || generation !== (generations.get(id) ?? 0))
                throw new HttpError(409, 'interrupted');
            if (performance.now() - started >= policy.expires_in_ms)
                throw new HttpError(409, 'expired');
        };
        try {
            if (action === 'activity.stop') {
                await stop(id);
                update(op.operation_id, { state: 'completed', confirmation: snapshot(id).connection === 'connected' ? 'ack' : 'none' });
                return;
            }
            check();
            if (action !== 'connection.disconnect' && powerTransitions.has(id))
                throw new HttpError(409, 'power_transition_busy');
            if (action === 'connection.disconnect') {
                if (powerTransitions.has(id))
                    throw new HttpError(409, 'power_transition_busy');
                powerTransitions.add(id);
                generations.set(id, (generations.get(id) ?? 0) + 1);
                try {
                    if (snapshot(id).connection === 'connected') {
                        await d.runtime.disconnect();
                        update(op.operation_id, { state: 'completed', confirmation: 'notification' });
                    }
                    else {
                        if (snapshot(id).connection === 'connecting' || pending.has(id))
                            await stop(id);
                        update(op.operation_id, { state: 'completed', confirmation: 'none' });
                    }
                }
                finally {
                    powerTransitions.delete(id);
                }
                return;
            }
            if (snapshot(id).control === 'failed')
                throw new HttpError(409, 'safety_failed');
            if (action === 'connection.connect') {
                if (snapshot(id).connection !== 'connected')
                    await d.runtime.connect();
                check();
                update(op.operation_id, { state: 'completed', confirmation: 'ack' });
                return;
            }
            if (snapshot(id).connection !== 'connected') {
                if (policy.if_unavailable === 'skip') {
                    update(op.operation_id, { state: 'skipped', reason: 'unavailable' });
                    return;
                }
                if (policy.if_unavailable !== 'connect')
                    throw new HttpError(503, 'connection_unavailable');
                if (!d.automationWake)
                    throw new HttpError(403, 'automation_wake_disabled');
                auth.require(grant, 'power', id);
                await d.runtime.connect();
                check();
            }
            if (d.runtime.busy()) {
                if (policy.if_busy === 'skip') {
                    update(op.operation_id, { state: 'skipped', reason: 'busy' });
                    return;
                }
                if (policy.if_busy !== 'replace')
                    throw new HttpError(409, 'resource_busy');
                await stop(id);
                generation = generations.get(id) ?? 0;
                check();
            }
            if (policy.cooldown_ms && !store.claimCooldown(`${grant.id}:${id}:${policy.cooldown_key}`, policy.cooldown_ms)) {
                update(op.operation_id, { state: 'skipped', reason: 'cooldown' });
                return;
            }
            check();
            sources.set(id, op.operation_id);
            update(op.operation_id, { state: 'running' });
            const result = await (prepared ? prepared.execute() : d.runtime.execute(action, parameters));
            if (generation !== (generations.get(id) ?? 0)) {
                update(op.operation_id, { state: 'interrupted', outcome_uncertain: true, confirmation: result.confirmation });
                return;
            }
            update(op.operation_id, result);
        }
        catch (error) {
            const code = error instanceof HttpError ? error.code : 'execution_failed';
            update(op.operation_id, {
                state: code === 'expired' ? 'expired' : code === 'interrupted' ? 'interrupted' : 'failed',
                reason: code,
                outcome_uncertain: !(error instanceof HttpError)
            });
        }
        finally {
            if (pending.get(id) === op.operation_id)
                pending.delete(id);
            events.emit('snapshot', snapshot(id), id);
        }
    }
    const server = createServer(async (req, res) => {
        const receivedAt = performance.now();
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        const ancestors = options.frameAncestors ?? [];
        if (ancestors.some(o => !/^https?:\/\/[a-zA-Z0-9.:[\]-]+$/.test(o)))
            throw Error('Invalid frame ancestor');
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${ancestors.join(' ')}; object-src 'none'; base-uri 'self'`);
        try {
            if (closing)
                throw new HttpError(503, 'service_stopping');
            const url = new URL(req.url ?? '/', 'http://localhost');
            if (prefix && !(url.pathname === prefix || url.pathname.startsWith(prefix + '/')))
                throw new HttpError(404, 'not_found');
            const path = url.pathname.slice(prefix.length) || '/';
            if (path === '/health' && req.method === 'GET') {
                json(res, 200, { status: 'ok' });
                return;
            }
            if (!path.startsWith('/api/')) {
                if (prefix && url.pathname === prefix) {
                    res.writeHead(308, { Location: prefix + '/' });
                    res.end();
                    return;
                }
                if (req.method !== 'GET' || !options.staticDirectory)
                    throw new HttpError(404, 'not_found');
                const root = resolve(options.staticDirectory);
                let file = resolve(root, '.' + decodeURIComponent(path));
                if (file !== root && !file.startsWith(root + sep))
                    throw new HttpError(404, 'not_found');
                if (path === '/' || path === '/index.html')
                    file = resolve(root, 'index.html');
                const info = await stat(file);
                if (!info.isFile())
                    throw new HttpError(404, 'not_found');
                let data = await readFile(file);
                if (extname(file) === '.html')
                    data = Buffer.from(data.toString().replace('<head>', '<head><meta name="mech-session" content="remote">'));
                const mime: Record<string, string> = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.css': 'text/css',
                    '.svg': 'image/svg+xml',
                    '.png': 'image/png',
                    '.woff2': 'font/woff2'
                };
                res.writeHead(200, {
                    'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
                    'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public,max-age=3600'
                });
                res.end(data);
                return;
            }
            if (path === '/api/v1/session' && req.method === 'POST') {
                const input = await body(req);
                keys(input, ['token']);
                const login = auth.login(req, text(input.token, 1024));
                json(
                    res, 200,
                    { authenticated: true, csrf_token: login.csrf, principal: login.grant.id },
                    { 'Set-Cookie': auth.cookie(login.id, !!options.secureCookies, !!options.crossSiteCookies) }
                );
                return;
            }
            const mutating = !['GET', 'HEAD'].includes(req.method ?? 'GET'),
                { grant, csrf, valid } = auth.authenticate(req, mutating);
            if (path === '/api/v1/session') {
                if (req.method === 'GET') {
                    json(res, 200, { authenticated: true, csrf_token: csrf, principal: grant.id });
                    return;
                }
                if (req.method === 'DELETE') {
                    auth.logout(req);
                    events.prune();
                    json(res, 200, { authenticated: false }, { 'Set-Cookie': auth.cookie('', !!options.secureCookies, !!options.crossSiteCookies) });
                    return;
                }
            }
            const revoke = path.match(/^\/api\/v1\/admin\/tokens\/([^/]+)\/revoke$/);
            if (revoke && req.method === 'POST') {
                auth.require(grant, 'admin');
                const id = decodeURIComponent(revoke[1]);
                const target = options.tokens.find(t => t.id === id);
                if (!target)
                    throw new HttpError(404, 'not_found');
                store.revokeToken(id);
                target.revoked = true;
                events.prune();
                for (const [droid, operationId] of new Map([...sources, ...pending]))
                    if (getOp(operationId)?.principal === id)
                        void stop(droid).catch(() => { });
                json(res, 200, { revoked: true });
                return;
            }
            if (req.method === 'GET') {
                if (path === '/api/v1') {
                    auth.require(grant, 'read');
                    json(res, 200, {
                        api_version: '1',
                        instance_id: instance,
                        features: ['catalogs', 'operations', 'events', 'preferences', 'remote-ui'],
                        motion: false
                    });
                    return;
                }
                if (path === '/api/v1/droids') {
                    auth.require(grant, 'read');
                    json(res, 200, { items: [...droids.keys()].filter(id => auth.allowed(grant, id)).map(snapshot) });
                    return;
                }
                if (path === '/api/v1/events') {
                    auth.require(grant, 'read');
                    events.attach(
                        res,
                        id => valid() && (!id || auth.allowed(grant, id)),
                        req.headers['last-event-id'] as string | undefined,
                        [...droids.keys()].filter(id => auth.allowed(grant, id)).map(snapshot),
                        prefix
                    );
                    return;
                }
            }
            const operation = path.match(/^\/api\/v1\/operations\/([^/]+)(\/cancel)?$/);
            if (operation) {
                const op = getOp(decodeURIComponent(operation[1]));
                if (!op)
                    throw new HttpError(404, 'not_found');
                scoped(grant, op.droid_id, operation[2] ? 'stop' : 'read');
                if (req.method === 'GET' && !operation[2]) {
                    json(res, 200, publicOp(op));
                    return;
                }
                if (req.method === 'POST' && operation[2]) {
                    const key = text(req.headers['idempotency-key']);
                    let accepted;
                    try {
                        accepted = store.accept(grant.id, key, op.droid_id, { action: 'activity.stop', cancels_operation_id: op.operation_id });
                    }
                    catch (e) {
                        if (String(e).includes('idempotency conflict'))
                            throw new HttpError(409, 'idempotency_conflict');
                        const now = new Date().toISOString();
                        accepted = {
                            created: true,
                            operation: {
                                operation_id: randomUUID(),
                                droid_id: op.droid_id,
                                action: 'activity.stop',
                                state: 'accepted',
                                confirmation: 'none',
                                revision: 1,
                                created_at: now,
                                updated_at: now,
                                principal: grant.id,
                                durability: 'unavailable'
                            } as Operation
                        };
                    }
                    memoryOps.set(accepted.operation.operation_id, accepted.operation);
                    if (accepted.created) {
                        update(accepted.operation.operation_id, { cancels_operation_id: op.operation_id });
                        const owns = sources.get(op.droid_id) === op.operation_id || pending.get(op.droid_id) === op.operation_id;
                        try {
                            if (owns)
                                await stop(op.droid_id);
                            update(accepted.operation.operation_id, { state: 'completed', confirmation: owns ? 'ack' : 'none' });
                        }
                        catch {
                            update(accepted.operation.operation_id, { state: 'failed', reason: 'safety_failed', outcome_uncertain: true });
                        }
                    }
                    json(res, 202, publicOp(getOp(accepted.operation.operation_id)!));
                    return;
                }
            }
            if (['/api/v1/ui/heartbeat', '/api/v1/ui/release'].includes(path) && req.method === 'POST') {
                const input = await body(req);
                keys(input, ['client_id', 'droid_id', 'visible']);
                const id = text(input.droid_id), client = text(input.client_id);
                scoped(grant, id, 'stop');
                const key = `${grant.id}:${id}:${client}`;
                if (path.endsWith('release') || input.visible === false) {
                    clients.delete(key);
                    try {
                        await stop(id);
                    }
                    catch {
                        throw new HttpError(409, 'safety_failed');
                    }
                    json(res, 200, { released: true });
                    return;
                }
                if (input.visible !== true)
                    throw new HttpError(400, 'visibility_required');
                if (clients.size >= 1000 && !clients.has(key))
                    throw new HttpError(429, 'client_limit');
                clients.set(key, {
                    principal: grant,
                    droid: id,
                    expires: Date.now() + 3500,
                    valid
                });
                json(res, 200, { lease_ms: 3500, motion: false });
                return;
            }
            const match = path.match(/^\/api\/v1\/droids\/([^/]+)(?:\/(.*))?$/);
            if (!match)
                throw new HttpError(404, 'not_found');
            const id = decodeURIComponent(match[1]),
                suffix = match[2] ?? '',
                d = scoped(grant, id, req.method === 'GET' ? 'read' : suffix === 'preferences' ? 'operate' : suffix === 'operations' ? null : 'operate');
            if (req.method === 'GET') {
                if (!suffix) {
                    json(res, 200, snapshot(id));
                    return;
                }
                if (suffix === 'capabilities') {
                    json(res, 200, {
                        motion: { available: false, reason: 'Remote transport motion safety has not been validated' },
                        sounds: true,
                        lights: true,
                        raw_commands: false,
                        firmware: false
                    });
                    return;
                }
                if (suffix === 'preferences') {
                    json(res, 200, store.preferences(id));
                    return;
                }
                if (suffix.startsWith('catalogs/')) {
                    const kind = suffix.slice(9);
                    if (!['sounds', 'animations', 'light_presets', 'protocols', 'paths'].includes(kind))
                        throw new HttpError(404, 'not_found');
                    const all = d.runtime.catalogs(kind).items,
                        revision = store.preferences(id).revision,
                        offset = Number(url.searchParams.get('cursor') ?? 0),
                        limit = Number(url.searchParams.get('limit') ?? 1000);
                    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
                        throw new HttpError(400, 'invalid_page');
                    json(res, 200, {
                        items: all.slice(offset, offset + limit),
                        revision,
                        next_cursor: offset + limit < all.length ? String(offset + limit) : null
                    }, { ETag: `"catalog-${revision}"` });
                    return;
                }
            }
            if (suffix === 'preferences' && req.method === 'PUT') {
                const input = await body(req);
                keys(input, ['revision', 'values']);
                const values = object(input.values);
                if (
                    !Number.isSafeInteger(input.revision)
                    || input.revision < 0
                    || Object.keys(values).length > 256
                    || Object.entries(values).some(([k, v]) =>
                        k.length > 128
                        || privateRuntimeKey(k)
                        || typeof v !== 'string'
                        || ['__proto__', 'constructor', 'prototype'].includes(k)
                    )
                )
                    throw new HttpError(400, 'invalid_preferences');
                let saved;
                try {
                    saved = store.savePreferences(id, input.revision, values);
                }
                catch (e) {
                    if (String(e).includes('revision'))
                        throw new HttpError(409, 'revision_conflict');
                    throw new HttpError(503, 'persistence_unavailable');
                }
                events.emit('catalog.changed', { revision: saved.revision }, id);
                json(res, 200, saved);
                return;
            }
            if (suffix === 'operations' && req.method === 'POST') {
                const input = operationBody(await body(req));
                const scope = input.action === 'activity.stop'
                    ? 'stop'
                    : input.action.startsWith('connection.') ? 'power' : 'operate';
                auth.require(grant, scope, id);
                auth.require(grant, 'stop', id);
                const key = text(req.headers['idempotency-key']);
                const start = receivedAt;
                let accepted, prepared: ReturnType<NonNullable<Runtime['prepare']>> | undefined;
                try {
                    accepted = store.accept(grant.id, key, id, input, () => {
                        if (!input.action.startsWith('connection.')
                            && input.action !== 'activity.stop'
                            && d.runtime.prepare) {
                            try {
                                prepared = d.runtime.prepare(input.action, input.parameters);
                            }
                            catch {
                                throw new HttpError(422, 'unsupported_action_or_parameters');
                            }
                        }
                        return {
                            parameters: prepared?.parameters ?? input.parameters,
                            policy: input.policy,
                            catalog_revision: store.preferences(id).revision
                        };
                    });
                }
                catch (e) {
                    if (e instanceof HttpError)
                        throw e;
                    if (String(e).includes('idempotency conflict'))
                        throw new HttpError(409, 'idempotency_conflict');
                    if (input.action !== 'activity.stop')
                        throw new HttpError(503, 'persistence_unavailable');
                    const now = new Date().toISOString();
                    accepted = {
                        created: true,
                        operation: {
                            operation_id: randomUUID(),
                            droid_id: id,
                            action: input.action,
                            state: 'accepted',
                            confirmation: 'none',
                            revision: 1,
                            created_at: now,
                            updated_at: now,
                            principal: grant.id,
                            durability: 'unavailable'
                        } as Operation
                    };
                }
                memoryOps.set(accepted.operation.operation_id, accepted.operation);
                if (memoryOps.size > 1000)
                    memoryOps.delete(memoryOps.keys().next().value!);
                const rateLimited = accepted.created
                    && !['activity.stop', 'connection.disconnect'].includes(input.action)
                    && !take(grant, id);
                if (rateLimited) {
                    update(accepted.operation.operation_id, { state: 'failed', reason: 'rate_limited' });
                    throw new HttpError(429, 'rate_limited');
                }
                if (accepted.created) {
                    const priority = ['activity.stop', 'connection.disconnect'].includes(input.action);
                    const wasPending = pending.has(id);
                    const pendingOperationBlocksRequest = wasPending && !priority && input.policy.if_busy !== 'replace';
                    if (pendingOperationBlocksRequest) {
                        update(accepted.operation.operation_id, { state: input.policy.if_busy === 'error' ? 'failed' : 'skipped', reason: 'busy' });
                    }
                    else {
                        if (!priority)
                            pending.set(id, accepted.operation.operation_id);
                        const task = (async () => {
                            const replacesPendingOperation = wasPending && !priority;
                            if (replacesPendingOperation) {
                                try {
                                    await stop(id);
                                }
                                catch {
                                    update(accepted.operation.operation_id, { state: 'failed', reason: 'safety_failed' });
                                    if (pending.get(id) === accepted.operation.operation_id)
                                        pending.delete(id);
                                    return;
                                }
                            }
                            await run(accepted.operation, input, grant, start, generations.get(id) ?? 0, prepared);
                        })();
                        workers.add(task);
                        void task.catch(() => { }).finally(() => workers.delete(task));
                    }
                }
                json(res, 202, publicOp(getOp(accepted.operation.operation_id) ?? accepted.operation), { Location: `${prefix}/api/v1/operations/${accepted.operation.operation_id}` });
                return;
            }
            throw new HttpError(405, 'method_not_allowed');
        }
        catch (error) {
            if (res.headersSent) {
                res.end();
                return;
            }
            const e = error instanceof HttpError ? error : new HttpError((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500, 'request_failed');
            json(res, e.status, { error: { code: e.code, message: e.message, retryable: false }, request_id: randomUUID() });
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    return {
        server,
        store,
        instanceId: instance,
        async close() {
            closing = true;
            clearInterval(timer);
            events.close();
            for (const f of unsub)
                f();
            await Promise.allSettled([...droids.keys()].map(stop));
            await Promise.allSettled([...workers]);
            await Promise.allSettled(options.droids.map(d => d.runtime.dispose()));
            server.closeAllConnections();
            if (server.listening)
                await new Promise<void>(r => server.close(() => r()));
            store.close();
        }
    };
}
