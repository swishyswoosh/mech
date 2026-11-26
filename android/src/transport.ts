import {NativeModules,NativeEventEmitter} from 'react-native';
import {AndroidTransportCore} from '../../core/transports/androidCore.ts';
export const native=NativeModules.R2Ble;
type BleEvents = {
 R2BleNotification: [{service:string;uuid:string;value:string}];
 R2BleDevice: [import('./devicePicker.ts').DiscoveredDroid];
 R2BleState: [{state:string;reason?:string}];
 R2BlePulse: [{id:string;state:string;reason?:string}];
};
export const events=new NativeEventEmitter<BleEvents>(native);
export {toBase64,fromBase64} from '../../core/transports/base64.ts';
export class AndroidTransport extends AndroidTransportCore {
 constructor(){super(native,events);}
}
