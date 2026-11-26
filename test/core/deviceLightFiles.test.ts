import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDeviceLightFile,exampleDeviceLights} from '../../core/deviceLightFiles.ts';
test('saved device light sequence round trips and never converts ordinary action recipes',()=>{
 assert.deepEqual(parseDeviceLightFile(JSON.stringify(exampleDeviceLights)),exampleDeviceLights);
 for(const value of [{version:1,name:'mixed',steps:[{action:{type:'audio',sector:2}}]}, {...exampleDeviceLights,frames:[{atMs:0,controls:Array(8).fill(0),transitionMs:80,audio:2}]}, {...exampleDeviceLights,name:''}])assert.throws(()=>parseDeviceLightFile(JSON.stringify(value)));
});
