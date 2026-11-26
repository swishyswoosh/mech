import type {Command,Packet,CharacteristicRef} from '../../core/index.ts';
import {commands,encodePacket,validateCommand} from '../../core/index.ts';
import {isManualDemand} from '../../core/transports/manualDemand.ts';
import {toBase64} from '../../core/transports/base64.ts';
interface NativePulse {armDrivePulse(id:string,service:string,demand:string,zero:string):Promise<void>;awaitDrivePulse(id:string):Promise<void>;cancelDrivePulse(id:string):Promise<void>}
interface Owner {id:string;command:Command;armed:boolean;ended:boolean;cancelled:boolean;resolveArmed:()=>void;closed:Promise<void>;resolveClosed:()=>void;finished?:Promise<void>;commandError?:unknown}
let nextPulse=0;
/** One accepted write arms a fixed native deadline; no repeated JS demand can renew it. */
export class FixedPulseDrive {
 private current?:Owner;private native:NativePulse;private fence:()=>void;
 constructor(native:NativePulse,fence:()=>void){this.native=native;this.fence=fence;}
 get active(){return !!this.current;}
 ended(id:string){const owner=this.current;if(!owner||owner.id!==id)return;owner.ended=true;this.fence();}
 async beforeWrite(command:Command&Partial<Pick<Packet,'seq'|'flags'>>,ref:CharacteristicRef){
  const owner=this.current;if(!owner||!isManualDemand(command))return;
  if(owner.cancelled||owner.ended||owner.armed||command.did!==owner.command.did||command.cid!==owner.command.cid||command.data.length!==owner.command.data.length||command.data.some((value,index)=>value!==owner.command.data[index]))throw new Error('A fixed pulse owns this drive intent');
  const stop=command.cid===7?commands.stop():command.cid===1?commands.rawMotors(0,0,0,0):commands.tank(0,0);
  const zero=encodePacket({...stop,flags:8,seq:255}),demand=encodePacket({...command,flags:command.flags??10,seq:command.seq??1});
  await this.native.armDrivePulse(owner.id,ref.service,toBase64(demand),toBase64(zero));owner.armed=true;
  owner.finished=this.native.awaitDrivePulse(owner.id);void owner.finished.catch(()=>{});owner.resolveArmed();
  if(owner.cancelled||owner.ended||this.current!==owner){await this.native.cancelDrivePulse(owner.id);throw new Error('Pulse canceled before transmission');}
  return owner.id;
 }
 async runAdvanced(command:Command,send:()=>Promise<unknown>):Promise<void>{return this.run(command,send,true);}
 async run(command:Command,send:()=>Promise<unknown>,advanced=false):Promise<void>{
  if(this.current)throw new Error('A pulse is already in progress');
  validateCommand(command);
  if(advanced){if(command.did!==22||![1,7,8].includes(command.cid)||!isManualDemand(command))throw new Error('Advanced pulse requires nonzero vetted heading, raw or tank demand');}
  else if(command.did!==22||command.cid!==8||command.data.length!==3||command.data[0]>63||command.data[1]>63||![0,8,16,24].includes(command.data[2])||!isManualDemand(command))throw new Error('Accessible pulse requires nonzero tank demand capped at 25%');
  let resolveArmed=()=>{};const armed=new Promise<void>(resolve=>{resolveArmed=resolve;});
  let resolveClosed=()=>{};const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
  const owner:Owner={closed,resolveClosed,id:`pulse-${++nextPulse}`,command:{...command,data:command.data.slice()},armed:false,ended:false,cancelled:false,resolveArmed};this.current=owner;
  const outcome=Promise.resolve().then(send).then(value=>({value}),error=>({error}));
  void outcome.then(result=>{if('error'in result&&!owner.ended){owner.commandError=result.error;if(owner.armed)void this.native.cancelDrivePulse(owner.id).catch(()=>{});}});
  try{
   await Promise.race([armed,outcome.then(result=>{if('error'in result)throw result.error;return armed;})]);
   await owner.finished;if(owner.commandError)throw owner.commandError;
  }finally{
   if(owner.armed&&!owner.ended)await this.native.cancelDrivePulse(owner.id).catch(()=>{});
   if(this.current===owner)this.current=undefined;owner.resolveClosed();
  }
 }
 async cancel(){const owner=this.current;if(!owner)return;owner.cancelled=true;owner.ended=true;this.fence();if(owner.armed){await this.native.cancelDrivePulse(owner.id);await owner.finished;}await owner.closed;}
}
