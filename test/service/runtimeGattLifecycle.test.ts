import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBluezFactory } from '../../service/bluezTransport.ts';
import { createDroidRuntime } from '../../service/droidRuntime.ts';

async function waitForFile(directory: string, name: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!existsSync(join(directory, name))) {
        if (Date.now() >= deadline) throw Error(`Timed out waiting for sidecar ${name}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

for (const operation of ['disposal', 'STOP'] as const) {
test(`runtime ${operation} retains ownership until its canceled GATT open sidecar exits`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mech-open-cleanup-'));
    const preferences = { load: () => null, save() {} };
    const factory = createBluezFactory({
        address: 'AA:BB:CC:DD:EE:FF',
        droidId: `gatt-${operation}`,
        pythonCommand: process.execPath,
        pythonArgs: [fileURLToPath(new URL('./gattOpenCleanupFake.mjs', import.meta.url)), directory],
    });
    const runtime = createDroidRuntime({ id: `gatt-${operation}`, name: 'R2', preferences, factory });
    const contender = createDroidRuntime({
        id: `gatt-${operation}`, name: 'R2', preferences,
        factory: { open: async () => { throw Error('Replacement transport reached'); } },
    });
    const opening = runtime.connect().then(() => null, error => error);
    let cancellation: Promise<void> | undefined;
    try {
        await waitForFile(directory, 'opening');
        const pid = Number(readFileSync(join(directory, 'opening'), 'utf8'));
        cancellation = operation === 'disposal' ? runtime.dispose() : runtime.stop();
        let finished = false;
        void cancellation.then(() => { finished = true; });
        if (operation === 'STOP') await cancellation;
        await waitForFile(directory, 'closing');
        await new Promise(setImmediate);
        assert.equal(finished, operation === 'STOP', 'disposal waits for cleanup; STOP promptly revokes intent');
        assert.doesNotThrow(() => process.kill(pid, 0), 'sidecar must remain held at the cleanup gate');
        await assert.rejects(contender.connect(), /runtime owner/i);
        writeFileSync(join(directory, 'release'), '');
        await cancellation;
        assert.match(String(await opening), /cancel/i);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        assert.equal(runtime.snapshot().connection.state, 'disconnected');
        await assert.rejects(contender.connect(), /Replacement transport reached/);
    } finally {
        writeFileSync(join(directory, 'release'), '');
        const cleanup = runtime.dispose();
        await cancellation;
        await cleanup;
        await opening;
        if (existsSync(join(directory, 'opening'))) await waitForFile(directory, 'exiting');
        await contender.dispose();
        rmSync(directory, { recursive: true, force: true });
    }
});
}
