package local.r2controller;
import java.util.*;
public final class BackgroundGattPolicyTest {
 static byte[] frame(int did,int cid,int seq,int... data){
  ArrayList<Integer> body=new ArrayList<>(Arrays.asList(10,did,cid,seq));for(int x:data)body.add(x);
  body.add((~body.stream().mapToInt(x->x).sum())&255);ArrayList<Byte> out=new ArrayList<>();out.add((byte)0x8d);
  for(int x:body){if(x==0x8d||x==0xd8||x==0xab){out.add((byte)0xab);out.add((byte)(x^0x88));}else out.add((byte)x);}out.add((byte)0xd8);
  byte[] bytes=new byte[out.size()];for(int i=0;i<bytes.length;i++)bytes[i]=out.get(i);return bytes;
 }
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args){
  for(int seq=1;seq<255;seq++){
   byte[] ping=frame(16,0,seq);
   check(BackgroundGattPolicy.allows(false,true,false,ping),"Background idle ping must retain the session: seq="+seq);
   check(!BackgroundGattPolicy.allows(false,false,false,ping),"Wrong service/characteristic or non-write admitted");
   check(!BackgroundGattPolicy.allows(false,true,true,ping),"Owned activity admitted");
   ping[ping.length-2]^=1;check(!BackgroundGattPolicy.allows(false,true,false,ping),"Corrupt ping admitted");
  }
  for(byte[] bytes:new byte[][]{frame(22,7,1,25,0,0,0),frame(23,15,2,0,20),frame(16,0,3,1),frame(24,9,4),new byte[0]})
   check(!BackgroundGattPolicy.allows(false,true,false,bytes),"Background activity admitted");
  check(!BackgroundGattPolicy.allows(false,true,false,null),"Null admitted");
  check(BackgroundGattPolicy.allows(true,false,true,null),"Foreground policy changed");
  System.out.println("BackgroundGattPolicy: exact idle ping only; motion, reads, payload, malformed and owned operations blocked");
 }
}
