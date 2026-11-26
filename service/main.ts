import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createService } from './server.ts';
import { runtimePreferences } from './preferences.ts';
import { OperationStore } from './store.ts';
import { createDroidRuntime } from './droidRuntime.ts';
import { createBluezFactory } from './bluezTransport.ts';
import { createEspHomeFactory } from './espHomeTransport.ts';
import { fileURLToPath } from 'node:url';
const file = process.argv[2];
if (!file) throw Error('Usage: node --experimental-strip-types service/main.ts /private/path/service.json');
const config = JSON.parse(readFileSync(file, 'utf8'));
const database = resolve(dirname(file), config.database ?? 'mech.sqlite');
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const store = new OperationStore(database);
chmodSync(database, 0o600);
const droids = config.droids.map((d: any) => {
    const preferences = runtimePreferences(store, d.id);
    if (d.proxy && d.bluetooth) throw Error('Choose local Bluetooth or ESPHome, not both');
    const identity = { address: d.address, droidId: d.id, name: d.name };
    let factory;
    if (d.proxy) {
        const encryptionKey = process.env[d.proxy.encryptionKeyEnv];
        if (!encryptionKey) throw Error('Configured ESPHome encryption key environment variable is missing');
        factory = createEspHomeFactory({ ...d.proxy, ...identity, encryptionKey });
    } else factory = createBluezFactory({ ...d.bluetooth, ...identity });
    return {
        id: d.id,
        name: d.name,
        automationWake: d.automationWake === true,
        runtime: createDroidRuntime({ id: d.id, name: d.name, preferences, factory }),
    };
});
const service = createService({
    ...config,
    droids,
    database,
    store,
    staticDirectory: config.staticDirectory
        ? resolve(dirname(file), config.staticDirectory)
        : fileURLToPath(new URL('../web/dist/', import.meta.url)),
});
const host = config.host ?? '127.0.0.1',
    port = config.port ?? 8787;
if (host !== '127.0.0.1' && host !== '::1' && config.allowLan !== true) throw Error('LAN binding requires allowLan: true');
service.server.listen(port, host, () =>
    console.log(
        `Mech local service listening on ${host}:${(service.server.address() as import('node:net').AddressInfo).port}; droids remain disconnected until explicitly requested.`,
    ),
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        void service.close().then(
            () => {
                process.exitCode = 0;
            },
            () => {
                process.exitCode = 1;
            },
        );
    });
