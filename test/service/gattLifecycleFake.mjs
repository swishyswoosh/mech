import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
    const { id, epoch, method } = JSON.parse(line);
    if (method === 'open' && process.argv[2] === 'lose-open') {
        process.stdout.write(JSON.stringify({ id, epoch, result: null }) + '\n' + JSON.stringify({ epoch, event: 'disconnected' }) + '\n');
        continue;
    }
    if (method === 'disconnect') {
        setTimeout(() => {
            process.stdout.write(JSON.stringify({ id, epoch, result: null }) + '\n');
            process.exit(0);
        }, 80);
        continue;
    }
    process.stdout.write(JSON.stringify({ id, epoch, result: method === 'read' ? 'AQ==' : null }) + '\n');
}
