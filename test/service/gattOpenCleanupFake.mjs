import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const directory = process.argv[2];
const keepAlive = setInterval(() => {}, 1000);
let closing = false;
process.on('SIGTERM', () => {
    if (closing) return;
    closing = true;
    const finish = () => {
        if (!existsSync(join(directory, 'release'))) return;
        clearInterval(poll);
        clearInterval(keepAlive);
        writeFileSync(join(directory, 'exiting'), '');
        process.exit(0);
    };
    const poll = setInterval(finish, 10);
    writeFileSync(join(directory, 'closing'), '');
    finish();
});
for await (const line of createInterface({ input: process.stdin })) {
    const { method } = JSON.parse(line);
    if (method !== 'open') throw Error(`Unexpected GATT operation ${method}`);
    writeFileSync(join(directory, 'opening'), String(process.pid));
}
