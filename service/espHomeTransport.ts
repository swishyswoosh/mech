import {fileURLToPath} from 'node:url';
import {createGattFactory, type GattConfig} from './gattTransport.ts';
export interface EspHomeConfig extends GattConfig {
 host:string;encryptionKey:string;port?:number;addressType?:0|1;
}
export function createEspHomeFactory(config:EspHomeConfig){
 const key=Buffer.from(config.encryptionKey,'base64');
 if(!config.host||key.length!==32||key.every(byte=>byte===0)||key.toString('base64')!==config.encryptionKey)throw Error('Invalid ESPHome configuration');
 if(config.port!==undefined&&(!Number.isInteger(config.port)||config.port<1||config.port>65535))throw Error('Invalid ESPHome port');
 if(config.addressType!==undefined&&![0,1].includes(config.addressType))throw Error('Invalid ESPHome address type');
 return createGattFactory({...config,project:fileURLToPath(new URL('./espHome/',import.meta.url)),openParams:{host:config.host,port:config.port??6053,encryptionKey:config.encryptionKey,addressType:config.addressType??0}});
}
