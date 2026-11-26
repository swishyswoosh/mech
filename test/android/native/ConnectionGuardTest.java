package local.r2controller;
public class ConnectionGuardTest {
  private static void check(boolean condition){if(!condition)throw new AssertionError();}
  public static void main(String[] args){
    ConnectionGuard guard=new ConnectionGuard();
    long first=guard.begin();check(guard.current(first));
    guard.invalidate();check(!guard.current(first));
    long second=guard.begin();check(!guard.current(first));check(guard.current(second));
    // Running the old deadline while the new connection is pending must do nothing.
    boolean newerClosed=false;if(guard.current(first))newerClosed=true;check(!newerClosed);
    guard.invalidate();check(!guard.current(second));
    System.out.println("ConnectionGuard: disconnected and superseded deadlines cannot affect a newer attempt");
  }
}
