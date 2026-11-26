import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cockpitSensorRows,cockpitDisplaySnapshot} from '../../../app/components/cockpitSensors.ts';
test('cockpit sensor rows retain zero, hide stale values and keep orientation distinct from gyro',()=>{
 const snapshot:any={state:'ready',detail:'',packets:[],sensors:{status:'streaming',sampleAt:1000,intervalMs:100,values:{'accelerometer.x':0,'accelerometer.y':.5,'accelerometer.z':1,'rawGyroscope.x':1,'rawGyroscope.y':2,'rawGyroscope.z':3,'attitude.pitch':90}},cockpitReadings:{'encoder.0':{value:0,at:1000},'encoder.1':{value:-10,at:1000},'battery.volts':{value:3.78,at:1000},'dome.degrees':{value:20,at:1000},'processor.celsius':{value:31,at:1000}}};
 const rows=cockpitSensorRows(snapshot,1200);assert.equal(rows.find(r=>r.label==='ACCEL')?.value,'X 0.00 · Y +0.50 · Z +1.00 raw');
 assert.equal(rows.find(r=>r.label==='GYRO')?.value,'X +1.00 · Y +2.00 · Z +3.00 raw');
 assert.equal(rows.find(r=>r.label==='WHEELS')?.value,'Left 0 · Right −10');
 assert.equal(rows.find(r=>r.label==='BATTERY')?.value,'3.78 V');
 assert.equal(rows.find(r=>r.label==='CPU')?.value,'+31 °C');
 assert.equal(cockpitSensorRows(snapshot,122000).find(r=>r.label==='BATTERY')?.value,'—');
 assert.deepEqual(cockpitSensorRows({...snapshot,state:'disconnected'},1200),cockpitSensorRows(undefined,1200));
});

test('signed readouts distinguish positive, negative, rounded zero and missing values',()=>{
 const snapshot:any={state:'ready',sensors:{status:'streaming',sampleAt:1000,intervalMs:1000,values:{'accelerometer.x':-.001,'accelerometer.y':-.5,'accelerometer.z':.5}},cockpitReadings:{'encoder.0':{value:12,at:1000},'encoder.1':{value:-12,at:1000},'dome.degrees':{value:20,at:1000},'stance.position':{value:2.5,at:1000},'shoulder.adc':{value:3200,at:1000},'processor.celsius':{value:-4,at:1000},'battery.volts':{value:3.8,at:1000}}};
 const rows=Object.fromEntries(cockpitSensorRows(snapshot,1200).map(r=>[r.label,r.value]));
 assert.equal(rows.ACCEL,'X 0.00 · Y −0.50 · Z +0.50 raw');
 assert.equal(rows.GYRO,'X — · Y — · Z — raw');
 assert.equal(rows.WHEELS,'Left +12 · Right −12');
 assert.equal(rows.DOME,'+20.0°');
 assert.equal(rows.SHOULDER,'3200 ADC · stance +2.5');
 assert.equal(rows.CPU,'−4 °C');
 assert.equal(rows.BATTERY,'3.80 V');
});


test('disconnected cockpit retains every sensor slot without stale values',()=>{
 const rows=cockpitSensorRows(undefined,1200);
 assert.deepEqual(rows.map(r=>r.label),['ACCEL','GYRO','WHEELS','DOME','SHOULDER','BATTERY','CPU']);
 assert.ok(rows.every(r=>r.value.includes('—')&&!/\d/.test(r.value)));
 const stale:any={state:'ready',connectionEpoch:1,cockpitReadings:{'battery.volts':{value:4.1,at:1200}}};
 assert.equal(cockpitDisplaySnapshot({...stale,state:'disconnected'},stale),undefined);
 const newConnection={...stale,connectionEpoch:2,cockpitReadings:{}};
 assert.equal(cockpitDisplaySnapshot(newConnection,stale),newConnection);
});
