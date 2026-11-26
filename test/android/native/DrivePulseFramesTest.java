package local.r2controller;
import java.util.*;
public final class DrivePulseFramesTest {
 private static byte[] frame(int mode,int[] data,int flags,int seq){ArrayList<Integer> body=new ArrayList<>(Arrays.asList(flags,22,mode,seq));int sum=flags+22+mode+seq;for(int value:data){body.add(value);sum+=value;}body.add((~sum)&255);ArrayList<Byte> bytes=new ArrayList<>();bytes.add((byte)0x8d);for(int value:body){if(value==0x8d){bytes.add((byte)0xab);bytes.add((byte)5);}else if(value==0xd8){bytes.add((byte)0xab);bytes.add((byte)0x50);}else if(value==0xab){bytes.add((byte)0xab);bytes.add((byte)0x23);}else bytes.add((byte)value);}bytes.add((byte)0xd8);byte[] result=new byte[bytes.size()];for(int i=0;i<result.length;i++)result[i]=bytes.get(i);return result;}
 private static void invalid(byte[] demand,byte[] zero){try{DrivePulseFrames.validate(demand,zero);throw new AssertionError("Invalid pulse frames accepted");}catch(IllegalArgumentException expected){}}
 public static void main(String[] args){
  int[] modes={1,7,8};int[][] demands={{2,255,1,216},{255,1,103,0},{255,141,24}};
  for(int i=0;i<modes.length;i++){int mode=modes[i],length=mode==8?3:4;byte[] demand=frame(mode,demands[i],10,141),zero=frame(mode,new int[length],8,255);if(DrivePulseFrames.validate(demand,zero)!=mode)throw new AssertionError("Mode lost");
   invalid(demand,frame(mode==8?7:8,new int[mode==8?4:3],8,255));
   int[] nonzero=new int[length];nonzero[0]=1;invalid(demand,frame(mode,nonzero,8,255));
   byte[] corrupt=demand.clone();corrupt[corrupt.length-2]^=1;invalid(corrupt,zero);
  }
  invalid(frame(7,new int[]{25,1,104,0},10,1),frame(7,new int[4],8,255));
  invalid(frame(1,new int[]{3,10,1,10},10,1),frame(1,new int[4],8,255));
  invalid(frame(8,new int[]{10,10,32},10,1),frame(8,new int[3],8,255));
  System.out.println("DrivePulseFrames: heading/raw/tank full-byte demands, exact matching zero modes and escaped frames passed");
 }
}
