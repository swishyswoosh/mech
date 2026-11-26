/** Every picker/native/initialization phase checks the operation that requested it. */
export class ConnectionAttempts {
 private epoch=0;
 cancel(){this.epoch++;}
 begin(){
  const epoch=++this.epoch;
  const current=()=>epoch===this.epoch;
  const check=()=>{if(!current())throw new Error('Connection cancelled');};
  return {current,check,async step<T>(operation:()=>Promise<T>):Promise<T>{check();const result=await operation();check();return result;}};
 }
}
