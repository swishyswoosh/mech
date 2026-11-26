import {createInterface} from 'node:readline';
if(process.env.ESP_TEST_CREDENTIAL)throw Error('Inherited credential');
let subscribed=false;
for await(const line of createInterface({input:process.stdin})){
 const {id,epoch,method,params}=JSON.parse(line);const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
 if(method==='write'){
  const bytes=Buffer.from(params.data,'base64');
  if(bytes[0]===99)continue;
  if(bytes[0]===96)await new Promise(resolve=>setTimeout(resolve,60));
  if(bytes[0]===97){send({event:'disconnected',epoch});continue;}
  if(params.ref.service!=='service-one'||params.ref.characteristic!=='char-one')throw Error('Lost reference');
  if(bytes.length===3 && (params.withResponse!==false||bytes[2]!==128))throw Error('Lost write semantics');
  if(subscribed)send({event:'notification',epoch:bytes[0]===98?epoch-1:epoch,ref:params.ref,data:'Cf8='});
 }
 if(method==='subscribe')subscribed=true;if(method==='unsubscribe')subscribed=false;
 send({id,epoch,result:method==='discover'?[{service:'service-one',characteristic:'char-one'}]:method==='read'?'AP+A':null});
 if(method==='disconnect')process.exit(0);
}
