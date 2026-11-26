package local.r2controller;
/** Bounded native watchdog batch: 113 bytes with Nordic light cancellation. */
final class SafetyStopFrames {
 static final int MAX_BYTES=128;
 static void validate(byte[] frames){
  if(frames==null||frames.length==0||frames.length>MAX_BYTES)
   throw new IllegalArgumentException("Safety stop must contain 1..128 framed bytes");
 }
}
