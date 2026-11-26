package local.r2controller;
public final class SourceLeasesTest {
 private static void check(boolean condition){if(!condition)throw new AssertionError();}
 public static void main(String[] args){
  SourceLeases sources=new SourceLeases();SafetyLease app=new SafetyLease();app.arm(0,500);
  sources.acquire("recipe:1",0);sources.acquire("movie:1",0);
  try{sources.acquire("recipe:1",1);throw new AssertionError("Active owner replaced");}catch(IllegalStateException expected){}
  for(long now=50;now<=200;now+=50){app.heartbeat(now);check(sources.renew("movie:1",now));}
  check(sources.expired(249)==null);check("recipe:1".equals(sources.expired(250)));check(!app.expired(250));
  check(!sources.renew("recipe:1",250)); // No resurrection after a stalled scheduler.
  sources.release("recipe:1");check(sources.expired(300)==null);
  try{sources.acquire("recipe:1",300);throw new AssertionError("Retired source reacquired");}catch(IllegalStateException expected){}
  sources.clear();check(sources.delay(1000)==-1);check(!sources.renew("movie:1",1000));
  sources.release("late:1");try{sources.acquire("late:1",1001);throw new AssertionError("Late acquire survived cancellation");}catch(IllegalStateException expected){}
  SourceLeases overlap=new SourceLeases();overlap.acquire("movie:stalled",0);overlap.acquire("resident:animation",0);
  for(long now=50;now<=200;now+=50)check(overlap.renew("resident:animation",now));
  check("movie:stalled".equals(overlap.expired(250)));check(!overlap.renew("movie:stalled",250));
  System.out.println("SourceLeases: independent 250 ms deadlines, exact-ID renewal, cancellation and cleanup passed");
 }
}
