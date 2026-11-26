import {commands} from '../../core/index.ts';
import type {Command} from '../../core/index.ts';
interface ProbeController {readonly state:string;probe(command:Command):Promise<{data:Uint8Array}>}
export interface CompatibilityReport {warnings:string[];replies:{label:string;hex:string}[]}
/** The UI and command port use this gate, not the protocol's earlier wake-ready signal. */
export class NativeSessionGate {
 private armed=false;
 private generation=0;
 reset(){this.armed=false;this.generation++;}
 visibleState(state:string){if(state!=='ready')this.reset();return state==='ready'&&!this.armed?'initializing':state;}
 assertReady(){if(!this.armed)throw new Error('Native safety is not ready');}
 async prepare(controller:ProbeController,arm:()=>Promise<void>,connected:()=>boolean):Promise<CompatibilityReport> {
  this.armed=false;const generation=this.generation;
  await arm();
  const warnings:string[]=[];const replies:CompatibilityReport["replies"]=[];
  for(const [label,command] of [['application version',commands.identity(0)],['board revision',commands.identity(3)],['battery voltage',commands.battery()],['battery state',commands.batteryState()]] as const){
   if(generation!==this.generation||!connected()||controller.state!=='ready')throw new Error('Connection changed during safety setup');
   try{const packet=await controller.probe(command);replies.push({label,hex:Array.from(packet.data).map(byte=>byte.toString(16).padStart(2,'0')).join(' ')||'(empty reply)'});}catch(error){warnings.push(`${label}: ${String(error)}`);if(controller.state!=='ready')throw error;}
  }
  if(generation!==this.generation||!connected()||controller.state!=='ready')throw new Error('Connection changed during safety setup');
  this.armed=true;return {warnings,replies};
 }
}
