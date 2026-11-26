package local.r2controller;
import java.util.*;
/** Validates the complete one-chunk API-v2 demand and matching response-free zero. */
final class DrivePulseFrames {
 private static int[] body(byte[] frame){
  if(frame.length<7||frame.length>20||(frame[0]&255)!=0x8d||(frame[frame.length-1]&255)!=0xd8)throw new IllegalArgumentException("Invalid pulse frame bounds");
  ArrayList<Integer> bytes=new ArrayList<>();
  for(int i=1;i<frame.length-1;i++){int value=frame[i]&255;if(value==0xab){if(++i>=frame.length-1)throw new IllegalArgumentException("Truncated pulse escape");int escape=frame[i]&255;if(escape==5)value=0x8d;else if(escape==0x50)value=0xd8;else if(escape==0x23)value=0xab;else throw new IllegalArgumentException("Invalid pulse escape");}else if(value==0x8d||value==0xd8)throw new IllegalArgumentException("Unescaped pulse byte");bytes.add(value);}
  int[] result=new int[bytes.size()];int sum=0;for(int i=0;i<result.length;i++){result[i]=bytes.get(i);sum+=result[i];}if((sum&255)!=255)throw new IllegalArgumentException("Invalid pulse checksum");return result;
 }
 static int validate(byte[] demand,byte[] zero){
  int[] motion=body(demand),stop=body(zero);if(motion.length<8||motion[0]!=10||motion[1]!=22||motion[3]==0||motion[3]==255)throw new IllegalArgumentException("Invalid pulse demand header");
  int mode=motion[2],length=mode==8?3:4;if(!Arrays.asList(1,7,8).contains(mode)||motion.length!=length+5)throw new IllegalArgumentException("Unsupported pulse mode");
  if(mode==7&&((motion[5]<<8)|motion[6])>359)throw new IllegalArgumentException("Invalid pulse heading");
  if(mode==8&&!Arrays.asList(0,8,16,24).contains(motion[6]))throw new IllegalArgumentException("Invalid pulse tank flags");
  if(mode==1&&(motion[4]>2||motion[6]>2))throw new IllegalArgumentException("Invalid pulse raw mode");
  boolean nonzero=mode==7?motion[4]>0:mode==8?(motion[4]>0||motion[5]>0):(motion[5]>0||motion[7]>0);
  if(!nonzero)throw new IllegalArgumentException("Pulse demand must be nonzero");
  if(stop.length!=length+5||stop[0]!=8||stop[1]!=22||stop[2]!=mode||stop[3]!=255)throw new IllegalArgumentException("Pulse zero mode mismatch");
  for(int i=4;i<stop.length-1;i++)if(stop[i]!=0)throw new IllegalArgumentException("Pulse zero has nonzero demand");return mode;
 }
}
