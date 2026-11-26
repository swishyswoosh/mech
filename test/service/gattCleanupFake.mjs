import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
let closing=false;
const close=()=>{if(closing)return;closing=true;setTimeout(()=>{writeFileSync(process.argv[2],'closed');process.exit(0);},80);};
process.on('SIGTERM',close);
for await(const line of createInterface({input:process.stdin})){
 const {id,epoch,method}=JSON.parse(line);
 process.stdout.write(JSON.stringify({id,epoch,result:null})+'\n');
 if(method==='disconnect')close();
}
