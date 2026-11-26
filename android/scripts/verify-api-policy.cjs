// Build gate: dependency upgrades must preserve the minimum Android API.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const native=JSON.parse(fs.readFileSync(path.join(root,'node_modules/react-native/package.json')));
if(native.version!=='0.88.1')throw new Error('Re-audit active React Native substitutions for '+native.version);
const build=fs.readFileSync(path.join(root,'build.gradle'),'utf8');
if(!/minSdkVersion\s*=\s*26\b/.test(build))throw new Error('Galaxy S9 support requires the Android 8/API 26 floor');
const allowed={BluetoothCompat:4,GattConnection:1,ModernDependencyApis:3,R2BleModule:2};
for(const file of fs.readdirSync(path.join(root,'app/src/main/java/local/r2controller'))){
 if(!file.endsWith('.java'))continue;
 const src=fs.readFileSync(path.join(root,'app/src/main/java/local/r2controller',file),'utf8');
 const count=(src.match(/@SuppressWarnings\("deprecation"\)/g)||[]).length;
 const expected=allowed[file.slice(0,-5)]||0;
 if(count!==expected)throw new Error('Review compatibility suppression change in '+file+': '+count+' vs '+expected);
 if(/@SuppressWarnings\("all"\)/.test(src))throw new Error('Broad suppression forbidden: '+file);
}
console.log('API policy: API 26 floor, pinned RN substitutions, reviewed compatibility suppressions');
