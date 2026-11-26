import {randomUUID} from 'node:crypto';
import type {ServerResponse} from 'node:http';
export class ServiceEvents {
 private epoch=randomUUID();private sequence=0;private history:any[]=[];private clients=new Set<{response:ServerResponse;allows:(id?:string)=>boolean}>();
 emit(type:string,data:unknown,droid_id?:string){const event={id:`${this.epoch}:${++this.sequence}`,type,droid_id,data,at:new Date().toISOString()};this.history.push(event);if(this.history.length>1000)this.history.shift();for(const c of this.clients)if(c.allows(droid_id))this.send(c.response,event);return event;}
 private send(response:ServerResponse,event:any){if(!response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)){response.end();}}
 attach(response:ServerResponse,allows:(id?:string)=>boolean,cursor:string|undefined,snapshots:any[],prefix:string){if(this.clients.size>=100){response.writeHead(429);response.end();return;}response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});const client={response,allows};this.clients.add(client);const index=cursor?this.history.findIndex(e=>e.id===cursor):-1;if(cursor&&index<0)this.send(response,{id:`${this.epoch}:${this.sequence}`,type:'resync_required',data:{reason:'cursor_unavailable'}});if(index>=0)for(const event of this.history.slice(index+1))if(allows(event.droid_id))this.send(response,event);for(const data of snapshots)this.send(response,{id:`${this.epoch}:${this.sequence}`,type:'snapshot',droid_id:data.droid_id,data});const timer=setInterval(()=>{if(!allows())response.end();else if(!response.write(': heartbeat\n\n'))response.end();},10000);timer.unref();response.on('close',()=>{clearInterval(timer);this.clients.delete(client);});}
 prune(){for(const c of this.clients)if(!c.allows())c.response.end();}
 close(){for(const c of this.clients)c.response.end();this.clients.clear();}
}
