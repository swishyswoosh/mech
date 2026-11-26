package local.r2controller;
public final class SafetyStopBoundsTest {
 public static void main(String[] args) {
  for(int size:new int[]{1,93,113,128})SafetyStopFrames.validate(new byte[size]);
  for(int size:new int[]{0,129})try{SafetyStopFrames.validate(new byte[size]);throw new AssertionError("Invalid size accepted: "+size);}catch(IllegalArgumentException expected){}
  System.out.println("SafetyStopFrames: accepts only 1–128 byte batches");
 }
}
