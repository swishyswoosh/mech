import {validateNordicInlineLedPayload} from "../../core/ramRecipe.ts";
import type {Command,Packet} from '../../core/index.ts';
import {SchedulerSourceLease} from '../../core/automationLease.ts';
import type {SourceLeasePort} from '../../core/automationLease.ts';
function enabledSource(command:Command):string|undefined {
 if(command.did!==0x17)return;
 if(command.cid===26&&validateNordicInlineLedPayload(command.data).kind==='schedule')return 'device-RAM-lights';
 if(command.cid===5)return 'animation';
 if(command.cid===15)return 'dome-target';
 if(command.cid===21)return 'leg-target';
 if([10,41,45,47].includes(command.cid)&&command.data[0]!==0)return `mode-${command.cid}`;
 if(command.cid===13&&command.data[0]!==0)return 'stance';
}
function disabledSource(command:Command):string|undefined {
 if(command.did!==0x17)return;
 if(command.cid===40&&command.data.length===0)return 'device-RAM-lights';
 if(command.cid===43)return 'animation';
 if([10,41,45,47].includes(command.cid)&&command.data[0]===0)return `mode-${command.cid}`;
 if(command.cid===13&&command.data[0]===0)return 'stance';
}
/** Explicit firmware source supervision. Each owner has its own 50 ms clock. */
export class ResidentSourceLeases {
 private owners=new Map<string,SchedulerSourceLease>();
 private pendingStops=new Map<string,{kind:string;owner:SchedulerSourceLease|undefined}>();
 private port:SourceLeasePort;private ready:()=>boolean;private failed:(error:unknown)=>void;
 constructor(port:SourceLeasePort,ready:()=>boolean,failed:(error:unknown)=>void){this.port=port;this.ready=ready;this.failed=failed;}
 async beforeWrite(command:Command&Partial<Pick<Packet,'seq'|'flags'>>){
  const stoppedKind=disabledSource(command);
  if(stoppedKind&&command.seq!==undefined&&command.flags!==undefined&&(command.flags&2))this.pendingStops.set(`${command.did}/${command.cid}/${command.seq}`,{kind:stoppedKind,owner:this.owners.get(stoppedKind)});
  const kind=enabledSource(command);if(!kind||this.owners.has(kind))return;
  const owner:SchedulerSourceLease=new SchedulerSourceLease(this.port,`resident-${kind}`,():boolean=>this.owners.get(kind)===owner&&this.ready(),this.failed);
  this.owners.set(kind,owner);
  try{if(!await owner.acquire())throw new Error('Resident source cancelled before transmission');}
  catch(error){if(this.owners.get(kind)===owner)this.owners.delete(kind);owner.close();throw error;}
 }
 observeResponse(packet:Packet){
  if(!(packet.flags&1))return;
  const key=`${packet.did}/${packet.cid}/${packet.seq}`,pending=this.pendingStops.get(key);
  if(!pending)return;this.pendingStops.delete(key);
  if(!packet.error&&pending.owner&&this.owners.get(pending.kind)===pending.owner){pending.owner.close();this.owners.delete(pending.kind);}
 }
 stopAll(){this.pendingStops.clear();for(const owner of this.owners.values())owner.close();this.owners.clear();}
}
