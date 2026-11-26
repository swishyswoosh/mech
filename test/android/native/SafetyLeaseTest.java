package local.r2controller;
public class SafetyLeaseTest {
  private static void check(boolean condition){if(!condition)throw new AssertionError();}
  public static void main(String[] args){
    SafetyLease lease=new SafetyLease();check(!lease.expired(10000));
    lease.arm(1000,500);check(!lease.expired(1499));check(lease.expired(1500));
    lease.heartbeat(1400);check(!lease.expired(1899));check(lease.expired(1900));
    lease.disarm();check(!lease.expired(10000));
    SafetyLease appTimeout=new SafetyLease(5000);
    appTimeout.arm(0,5000);check(!appTimeout.expired(4999));check(appTimeout.expired(5000));
    appTimeout.heartbeat(250);check(!appTimeout.expired(5249));check(appTimeout.expired(5250));
    try{appTimeout.arm(0,5001);throw new AssertionError("accepted invalid app timeout");}catch(IllegalArgumentException expected){}
    for(int invalid:new int[]{0,149,1001}){try{lease.arm(0,invalid);throw new AssertionError("accepted invalid lease");}catch(IllegalArgumentException expected){}}
    SafetyLease application=new SafetyLease(),manual=new SafetyLease();application.arm(0,500);manual.arm(0,250);
    for(int now=100;now<=600;now+=100)application.heartbeat(now);
    check(!application.expired(600));check(manual.expired(250));check(manual.expired(600));
    manual.disarm();check(!manual.expired(1000));
    manual.arm(2000,250);manual.disarm(); // Successful zero-demand protocol reply.
    application.heartbeat(3000);check(!manual.expired(3000));
    System.out.println("SafetyLease: monotonic expiry, heartbeat, disarm, bounds passed");
  }
}
