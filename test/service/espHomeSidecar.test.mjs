import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Python sidecar dispatches GATT with injected BLE and no dependency/network startup',()=>{
 const result=spawnSync('python3',['-m','unittest','discover','-s','test/service','-p','*_sidecar_test.py'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
