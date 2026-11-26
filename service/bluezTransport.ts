import {fileURLToPath} from 'node:url';
import {createGattFactory, type GattConfig} from './gattTransport.ts';
export interface BluezConfig extends GattConfig {adapter?:string}
export function createBluezFactory(config:BluezConfig){
 const adapter=config.adapter??'hci0';
 if(!/^hci[0-9]+$/.test(adapter))throw Error('Invalid BlueZ adapter');
 return createGattFactory({...config,project:fileURLToPath(new URL('./bluez/',import.meta.url)),openParams:{adapter}});
}
