import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as display from '../../../app/components/cockpitSensors.ts';
const sample=(at:number,x:number,yaw=0,epoch=1):any=>({state:'ready',connectionEpoch:epoch,sensors:{status:'streaming',schemaEpoch:1,intervalMs:200,sampleAt:at,values:{'rawGyroscope.x':x,'accelerometer.x':x,'attitude.yaw':yaw}}});
test('cockpit averages a short window without changing raw samples or freshness timestamps',()=>{
 const Window=(display as any).CockpitDisplayWindow;assert.equal(typeof Window,'function');
 const window=new Window();const a=sample(1000,-.2,179),b=sample(1200,.2,-179);
 window.add(a);window.add(b);window.add(b);
 const result=window.read(1300);
 assert.equal(result.sensors.values['rawGyroscope.x'],0);
 assert.equal(result.sensors.values['accelerometer.x'],0);
 assert.equal(Math.abs(result.sensors.values['attitude.yaw']),180);
 assert.equal(b.sensors.values['rawGyroscope.x'],.2);
 assert.equal(result.sensors.sampleAt,1200);
 assert.match(display.cockpitSensorRows(window.read(1900),1900).find(r=>r.label==='GYRO')!.value,/X —/);
 window.add(sample(2000,9,30,2));assert.equal(window.read(2100).sensors.values['rawGyroscope.x'],9);
});
test('slow battery and temperature readbacks stay visible through their cadence but expire',()=>{
 const snapshot:any={state:'ready',cockpitReadings:{'battery.volts':{value:3.8,at:1000},'processor.celsius':{value:32,at:1000},'encoder.0':{value:8,at:1000}}};
 assert.equal(display.cockpitSensorRows(snapshot,61000).find(r=>r.label==='BATTERY')?.value,'3.80 V');
 assert.equal(display.cockpitSensorRows(snapshot,61000).find(r=>r.label==='CPU')?.value,'+32 °C');
 assert.equal(display.cockpitSensorRows(snapshot,61000).find(r=>r.label==='WHEELS')?.value,'Left — · Right —');
 assert.equal(display.cockpitSensorRows(snapshot,122000).find(r=>r.label==='BATTERY')?.value,'—');
});
