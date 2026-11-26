package local.r2controller;
/** Background activity is stopped, but an idle link still needs its empty echo.
 * Validate the entire API-v2 packet: no fragments, payload or actuator traffic. */
final class BackgroundGattPolicy {
 static boolean allows(boolean foreground,boolean apiWrite,boolean owned,byte[] frame){
  if(foreground)return true;
  if(!apiWrite||owned||frame==null||frame.length<7||frame.length>12||(frame[0]&255)!=0x8d||(frame[frame.length-1]&255)!=0xd8)return false;
  int[] body=new int[5];int count=0,sum=0;
  for(int i=1;i<frame.length-1;i++){
   int value=frame[i]&255;
   if(value==0xab){if(++i>=frame.length-1)return false;int escape=frame[i]&255;if(escape!=5&&escape!=0x50&&escape!=0x23)return false;value=escape^0x88;}
   else if(value==0x8d||value==0xd8)return false;
   if(count==body.length)return false;body[count++]=value;sum+=value;
  }
  return count==5&&body[0]==10&&body[1]==16&&body[2]==0&&body[3]>0&&body[3]<255&&(sum&255)==255;
 }
}
