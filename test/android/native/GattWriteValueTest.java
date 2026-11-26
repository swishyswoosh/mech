package local.r2controller;
import java.util.*;
public final class GattWriteValueTest {
 public static void main(String[] args){
  byte[] demand={(byte)0x8d,10,22,7,110,64,0,0,0,42,(byte)0xd8};
  byte[] sensor={(byte)0x8e,(byte)0xbd,(byte)0xd4};
  final byte[][] transmitted={null};final int[] api={0};
  GattWriteValue.Writer racing=new GattWriteValue.Writer(){
   public int explicitValue(byte[] value,int type){api[0]=33;transmitted[0]=value.clone();return 0;}
  };
  if(!GattWriteValue.submit(demand,2,racing)||!Arrays.equals(transmitted[0],demand)||api[0]!=33)
   throw new AssertionError("Concurrent sensor notification replaced the outgoing drive bytes");
  GattWriteValue.Writer rejected=new GattWriteValue.Writer(){public int explicitValue(byte[] v,int t){return 201;}};
  if(GattWriteValue.submit(demand,2,rejected))throw new AssertionError("Non-success GATT status accepted");
  System.out.println("GattWriteValue: Android33+ uses explicit immutable packet bytes despite notification mutation; status failures rejected");
 }
}
