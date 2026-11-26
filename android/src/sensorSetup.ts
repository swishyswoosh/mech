import {commands} from '../../core/index.ts';
import type {Command,Packet} from '../../core/index.ts';
import {installSensorSchema,SensorSession} from '../../core/sensorSession.ts';
interface SensorSetupPort {
 execute(command:Command):Promise<Packet>;
 stopMotion():Promise<void>;
 disconnect():Promise<void>;
 reconnect():Promise<void>;
 check():void;
 ready():void;
 publish():void;
}
/** A new GATT session prevents queued old-schema notifications becoming current data. */
export async function startNativeSensorStream(session:SensorSession,port:SensorSetupPort){
 try{
 session.reset('stale · installing schema');port.publish();port.check();
 await port.execute(commands.streaming(0,0,0));port.check();
 await port.stopMotion();port.check();
 await port.disconnect();port.check();
 await port.reconnect();port.check();port.ready();
 await installSensorSchema(async command=>{port.check();const packet=await port.execute(command);port.check();return packet;});
 port.check();port.ready();session.enable();port.publish();
 }catch(error){session.reset('stale · setup failed or cancelled');port.publish();await port.disconnect().catch(()=>{});throw error;}
}
