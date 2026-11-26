import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { BleTransport, CharacteristicRef } from '../core/controller.ts';
import type { TransportFactory, TransportRequest } from '../app/session/types.ts';
export interface GattConfig {
    address: string;
    droidId: string;
    name?: string;
    requestTimeoutMs?: number;
    connectTimeoutMs?: number;
    /** Packaged interpreter override. Credentials use private IPC instead of process arguments. */
    pythonCommand?: string;
    pythonArgs?: string[];
}
interface GattSidecarConfig extends GattConfig {
    project: string;
    openParams: Record<string, unknown>;
}
const MAX_LINE = 65536,
    MAX_QUEUE = 64;
const key = (ref: CharacteristicRef) => `${ref.service.toLowerCase()}/${ref.characteristic.toLowerCase()}`;
function decode(value: unknown): Uint8Array {
    if (
        typeof value !== 'string' ||
        value.length > MAX_LINE ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    )
        throw Error('Invalid GATT byte encoding');
    return new Uint8Array(Buffer.from(value, 'base64'));
}
class GattTransport implements BleTransport {
    private child: ChildProcessWithoutNullStreams;
    private pending = new Map<
        number,
        { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();
    private listeners = new Map<string, Set<(bytes: Uint8Array) => void>>();
    private sequence = 0;
    private closed = false;
    private closing = false;
    private disconnecting?: Promise<void>;
    private generation = 0;
    private queued = 0;
    private readonly exited: Promise<void>;
    private killTimer?: ReturnType<typeof setTimeout>;
    private tail: Promise<unknown> = Promise.resolve();
    private buffer = '';
    private readonly epoch: number;
    private readonly timeout: number;
    private readonly onLoss: () => void;
    private readonly release: () => void;
    constructor(config: GattSidecarConfig, epoch: number, onLoss: () => void, release: () => void) {
        this.epoch = epoch;
        this.timeout = config.requestTimeoutMs ?? 5000;
        this.onLoss = onLoss;
        this.release = release;
        const project = config.project;
        const env: NodeJS.ProcessEnv = {};
        // The child inherits runtime paths/locales only, so service token/key variables stay private.
        for (const name of [
            'PATH',
            'HOME',
            'USERPROFILE',
            'SystemRoot',
            'WINDIR',
            'TMPDIR',
            'TMP',
            'TEMP',
            'LANG',
            'LC_ALL',
            'XDG_CACHE_HOME',
            'UV_CACHE_DIR',
        ])
            if (process.env[name] !== undefined) env[name] = process.env[name];
        this.child = spawn(
            config.pythonCommand ?? 'uv',
            config.pythonArgs ?? ['run', '--frozen', '--project', project, 'python', `${project}sidecar.py`],
            { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env },
        );
        this.exited = new Promise((resolve) =>
            this.child.once('close', () => {
                clearTimeout(this.killTimer);
                this.release();
                resolve();
            }),
        );
        this.child.stdout.setEncoding('utf8');
        this.child.stdout.on('data', (chunk: string) => this.receive(chunk));
        // Silent stderr draining prevents dependency diagnostics from exposing host configuration.
        this.child.stderr.resume();
        this.child.on('error', () => this.fail(Error('GATT sidecar could not start')));
        this.child.on('exit', () => this.fail(Error('GATT connection lost')));
        this.child.stdin.on('error', () => this.fail(Error('GATT IPC closed')));
    }
    private fail(error: Error, notify = true) {
        if (this.closed) return;
        this.closed = true;
        this.generation++;
        this.listeners.clear();
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(error);
        }
        this.pending.clear();
        // Pending work fails immediately; ownership remains held until bounded child cleanup finishes.
        this.child.stdin.end();
        this.child.kill('SIGTERM');
        this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), 8000);
        this.killTimer.unref();
        if (notify && !this.closing) this.onLoss();
    }
    cancel() {
        this.fail(Error('GATT connection canceled'));
    }
    private receive(chunk: string) {
        if (this.closed) return;
        this.buffer += chunk;
        for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            if (line.length > MAX_LINE) {
                this.fail(Error('GATT IPC message too large'));
                return;
            }
            try {
                const message = JSON.parse(line);
                if (message.epoch !== this.epoch) continue;
                if (message.event === 'disconnected') {
                    this.fail(Error('GATT connection lost'));
                    return;
                }
                if (message.event === 'notification') {
                    const bytes = decode(message.data);
                    for (const listener of this.listeners.get(key(message.ref)) ?? []) listener(bytes);
                    continue;
                }
                const p = this.pending.get(message.id);
                if (!p) continue;
                this.pending.delete(message.id);
                clearTimeout(p.timer);
                if (message.error)
                    p.reject(Error(`GATT ${/^[a-z_]+$/.test(message.error.code) ? message.error.code : 'operation_failed'}`));
                else p.resolve(message.result);
            } catch {
                this.fail(Error('Invalid GATT IPC message'));
                return;
            }
        }
        if (this.buffer.length > MAX_LINE) this.fail(Error('GATT IPC message too large'));
    }
    assertOpen() {
        if (this.closed || this.closing) throw Error('GATT connection closed');
    }
    rpc<T>(method: string, params: Record<string, unknown> = {}, timeout = this.timeout): Promise<T> {
        if (this.closed || (this.closing && method !== 'disconnect')) return Promise.reject(Error('GATT connection closed'));
        const id = ++this.sequence;
        const line = JSON.stringify({ id, epoch: this.epoch, method, params }) + '\n';
        if (line.length > MAX_LINE) return Promise.reject(Error('GATT request too large'));
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => this.fail(Error('GATT request timed out; connection closed')), timeout);
            this.pending.set(id, { resolve: (result) => resolve(result as T), reject, timer });
            this.child.stdin.write(line, (error) => {
                if (error) this.fail(Error('GATT IPC write failed'));
            });
        });
    }
    private serial<T>(operation: () => Promise<T>, priority = false): Promise<T> {
        if (this.closed || this.closing) return Promise.reject(Error('GATT connection closed'));
        if (!priority && this.queued >= MAX_QUEUE) return Promise.reject(Error('GATT operation queue full'));
        const generation = this.generation;
        this.queued++;
        const work = this.tail
            .then(() => {
                this.assertOpen();
                if (generation !== this.generation) throw Error('GATT operation canceled by STOP');
                return operation();
            })
            .finally(() => {
                this.queued--;
            });
        this.tail = work.catch(() => {});
        return work;
    }
    discover() {
        return this.serial(() => this.rpc<CharacteristicRef[]>('discover'));
    }
    read(ref: CharacteristicRef) {
        return this.serial(async () => decode(await this.rpc('read', { ref })));
    }
    write(ref: CharacteristicRef, data: Uint8Array, withResponse: boolean) {
        const encoded = Buffer.from(data).toString('base64');
        return this.serial(() => this.rpc<void>('write', { ref, data: encoded, withResponse }));
    }
    async subscribe(ref: CharacteristicRef, listener: (bytes: Uint8Array) => void) {
        const id = key(ref);
        await this.serial(async () => {
            let listeners = this.listeners.get(id);
            if (listeners) {
                listeners.add(listener);
                return;
            }
            listeners = new Set([listener]);
            this.listeners.set(id, listeners);
            try {
                await this.rpc('subscribe', { ref });
            } catch (error) {
                this.listeners.delete(id);
                throw error;
            }
        });
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            const listeners = this.listeners.get(id);
            listeners?.delete(listener);
            if (listeners && !listeners.size) {
                this.listeners.delete(id);
                void this.serial(() => this.rpc('unsubscribe', { ref })).catch(() => {});
            }
        };
    }
    emergencyWrite(ref: CharacteristicRef, frames: Uint8Array[]) {
        this.generation++;
        const copied = frames.map((frame) => new Uint8Array(frame));
        return this.serial(async () => {
            for (const frame of copied)
                for (let i = 0; i < frame.length; i += 20)
                    await this.rpc('write', { ref, data: Buffer.from(frame.subarray(i, i + 20)).toString('base64'), withResponse: true });
        }, true);
    }
    priorityWrite(ref: CharacteristicRef, frames: Uint8Array[]) {
        return this.emergencyWrite(ref, frames);
    }
    disconnect(): Promise<void> {
        if (this.disconnecting) return this.disconnecting;
        if (this.closed) return this.exited;
        // Closing fences queued/new operations before the sidecar acknowledges teardown.
        this.closing = true;
        this.generation++;
        this.disconnecting = (async () => {
            try {
                await this.rpc('disconnect');
            } finally {
                this.fail(Error('GATT connection closed'), false);
                await this.exited;
            }
        })();
        return this.disconnecting;
    }
}
/** No process, discovery or connection until explicit open. One child owns one epoch. */
export function createGattFactory(config: GattSidecarConfig): TransportFactory {
    if (!config.droidId || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(config.address)) throw Error('Invalid GATT enrollment');
    for (const timeout of [config.requestTimeoutMs ?? 5000, config.connectTimeoutMs ?? 20000])
        if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120000) throw Error('Invalid GATT timeout');
    let active: GattTransport | undefined;
    let epoch = 0;
    return {
        authorizedDroids: async () => [{ id: config.droidId, name: config.name ?? 'R2-D2' }],
        async open(request: TransportRequest) {
            request.check();
            if (request.authorizedId && request.authorizedId !== config.droidId) throw Error('Droid is not enrolled');
            if (active) throw Error('GATT connection already active');
            const transport = new GattTransport(config, ++epoch, request.onDisconnect, () => {
                if (active === transport) active = undefined;
            });
            active = transport;
            try {
                await transport.rpc(
                    'open',
                    {
                        ...config.openParams,
                        address: config.address,
                        services: request.services,
                        timeoutMs: config.connectTimeoutMs ?? 20000,
                    },
                    config.connectTimeoutMs ?? 20000,
                );
                request.check();
                // Loss can follow the open reply before this awaiting continuation resumes.
                transport.assertOpen();
                return { transport, id: config.droidId, name: config.name ?? 'R2-D2', hardwareId: config.address };
            } catch (error) {
                transport.cancel();
                // A failed open has no returned transport for its caller to close.
                await transport.disconnect();
                throw error;
            }
        },
        cancel() {
            active?.cancel();
        },
    };
}
