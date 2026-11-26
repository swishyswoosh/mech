package local.r2controller;
public final class FixedPulseDeadlineTest {
 private static void check(boolean condition){if(!condition)throw new AssertionError();}
 public static void main(String[] args){
  FixedPulseDeadline pulse=new FixedPulseDeadline();SafetyLease manual=new SafetyLease(),app=new SafetyLease();pulse.arm("pulse:1",0);manual.arm(0,250);app.arm(0,500);
  for(int now=50;now<=200;now+=50){manual.heartbeat(now);app.heartbeat(now);}
  check(!pulse.expire("pulse:1",199));check(pulse.expire("pulse:1",200));check(!pulse.active());check(!manual.expired(200));check(!app.expired(200));
  pulse.arm("pulse:2",201);check(!pulse.expire("pulse:1",1000));check(pulse.matches("pulse:2"));
  check(pulse.cancel("pulse:2"));pulse.arm("pulse:3",210);check(!pulse.cancel("pulse:2"));check(pulse.matches("pulse:3"));pulse.clear();check(!pulse.active());
  try{pulse.arm("pulse:1",1000);throw new AssertionError("Retired pulse rearmed");}catch(IllegalStateException expected){}
  FixedPulseDeadline delayedAdmission=new FixedPulseDeadline();delayedAdmission.arm("pulse:heartbeat-gap",0);
  manual.arm(0,250);manual.heartbeat(100); // JS may stall after this native acknowledgment.
  check(!delayedAdmission.admitWrite("pulse:heartbeat-gap",201));check(!delayedAdmission.startWrite("pulse:heartbeat-gap",201));
  FixedPulseDeadline queued=new FixedPulseDeadline();queued.arm("pulse:queued",0);check(queued.admitWrite("pulse:queued",50));
  check(!queued.startWrite("pulse:queued",200)); // Deadline callback need not have run yet.
  check(queued.expire("pulse:queued",200));queued.arm("pulse:new-owner",201);
  check(!queued.admitWrite("pulse:queued",202));check(!queued.startWrite("pulse:queued",202));
  check(queued.admitWrite("pulse:new-owner",202));check(!queued.admitWrite("pulse:new-owner",203));
  check(queued.startWrite("pulse:new-owner",203));check(!queued.startWrite("pulse:new-owner",204));
  System.out.println("FixedPulseDeadline: nonrenewable 200 ms expiry, exact owners and cleanup passed");
 }
}
