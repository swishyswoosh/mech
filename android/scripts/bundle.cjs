// Noninteractive validation bundle: Metro's CLI creates file watchers unnecessarily.
const Metro = require('metro');
(async () => {
 const config = await Metro.loadConfig({cwd: require('path').resolve(__dirname, '..')});
 config.maxWorkers = 2;
 await Metro.runBuild(config, {entry: 'index.js', platform: 'android', dev: false, minify: true, out: '/tmp/r2-controller.android.bundle'});
})().catch(error => {console.error(error); process.exitCode = 1;});
