import http from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stopPlan} from '../core/gates.ts';
import {encodePacket} from '../core/protocol.ts';

export const allowedOrigins=new Set(['http://127.0.0.1:5173','http://127.0.0.1:5174','http://localhost:5173','http://localhost:5174']);
export function createBridge(engine,{timeoutMs=8000}={}) {
 let session,events,provisionalTimer,adapterState,droid=null,sequence=0,closing=Promise.resolve();
 const pending=new Map();
 const request=(method,args={})=>new Promise((resolve,reject)=>{
  const id=++sequence;
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Native ${method} timed out`));},timeoutMs);
  pending.set(id,{resolve,reject,timer});engine.send({id,method,...args});
 });
 const off=engine.listen(message=>{
  if(typeof message.id==='number'){const op=pending.get(message.id);if(op){pending.delete(message.id);clearTimeout(op.timer);message.error?op.reject(new Error(message.error)):op.resolve(message.result)}}
  else if(message.event){if(message.event==='adapter')adapterState=message.state;if(['droid','robot'].includes(message.event)&&typeof message.id==='string'&&typeof message.name==='string')droid={id:message.id,name:message.name};events?.write(`data: ${JSON.stringify(message)}\n\n`)}
 });
 const release=()=>{
  if(!session)return closing;
  session=undefined;clearTimeout(provisionalTimer);const stream=events;events=undefined;stream?.end();
  closing=closing.then(async()=>{
   // Transport loss revokes firmware sources even when the page cannot send STOP.
   try{await request('emergency',{ref:{service:'00010001-574f-4f20-5370-6865726f2121',characteristic:'00010002-574f-4f20-5370-6865726f2121'},frames:stopPlan('tank').map(c=>Buffer.from(encodePacket({...c,seq:255,flags:8})).toString('base64'))})}catch{}
   await request('disconnect');
  }).catch(error=>console.error('Native cleanup failed:',error.message));return closing;
 };
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(!allowedOrigins.has(origin)){res.writeHead(403);res.end('Controller origin required');return}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return}
  const url=new URL(req.url,'http://127.0.0.1');
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
  if(req.method==='GET'&&url.pathname==='/status'){json(200,{available:adapterState===5,target:droid?.name??null,droid});return}
  if(req.method==='POST'&&url.pathname==='/session'){
   if(session){json(409,{error:'Another controller owns desktop Bluetooth'});return}
   await closing;if(session){json(409,{error:'Another controller owns desktop Bluetooth'});return}
   session=randomUUID();provisionalTimer=setTimeout(()=>{if(!events)void release()},5000);json(200,{session});return
  }
  const supplied=req.headers['x-r2-session']??url.searchParams.get('session');
  if(!session||supplied!==session){json(403,{error:'Invalid desktop session'});return}
  if(req.method==='GET'&&url.pathname==='/events'){
   if(events){json(409,{error:'Event stream already open'});return}
   clearTimeout(provisionalTimer);events=res;res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write('data: {"event":"ready"}\n\n');
   const ping=setInterval(()=>res.write(': keepalive\n\n'),10000);const owner=session;
   res.on('close',()=>{clearInterval(ping);if(session===owner)void release()});return
  }
  if(req.method!=='POST'||url.pathname!=='/rpc'){json(404,{error:'Unknown endpoint'});return}
  const owner=session;let body='';
  try{
   for await(const chunk of req){body+=chunk;if(body.length>65536)throw new Error('Payload too large')}
   const message=JSON.parse(body);const methods=new Set(['discover','read','write','subscribe','unsubscribe','emergency','disconnect']);
   if(!methods.has(message.method))throw new Error('Unknown Bluetooth operation');
   if(owner!==session||supplied!==session)throw new Error('Desktop session changed');
   if(message.method==='disconnect'){await release();json(200,{result:null});return}
   const result=await request(message.method,{ref:message.ref,data:message.data,frames:message.frames});
   if(owner!==session)throw new Error('Desktop session changed');json(200,{result});
  }catch(error){json(400,{error:error.message})}
 });
 return {server,close:async()=>{await release();off();for(const op of pending.values()){clearTimeout(op.timer);op.reject(new Error('Bridge closed'))}pending.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const child=spawn('/usr/bin/swift',['-module-cache-path','/tmp/droid-swift-module-cache',fileURLToPath(new URL('./BluetoothEngine.swift',import.meta.url))],{stdio:['pipe','pipe','inherit']});
 const listeners=new Set();createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line);for(const listener of listeners)listener(message)}catch{console.error(line)}});
 const bridge=createBridge({send:message=>child.stdin.write(JSON.stringify(message)+'\n'),listen:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}});
 bridge.server.listen(5180,'127.0.0.1',()=>console.log('Desktop Bluetooth ready at http://127.0.0.1:5180 (R2 discovery)'));
 child.on('exit',code=>{console.error('Native Bluetooth engine exited:',code);void bridge.close().finally(()=>process.exit(1))});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void bridge.close().finally(()=>{child.stdin.end();setTimeout(()=>child.kill(),1000).unref()}));
}
