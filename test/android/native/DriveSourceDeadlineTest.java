package local.r2controller;
public class DriveSourceDeadlineTest {
 static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
 public static void main(String[] args)throws Exception {
  SourceLeases s=new SourceLeases();s.acquire("path-old",100,true);
  check(s.admitsDrive("path-old",349),"active path writes must be bound to a drive scheduler");
  check(!s.admitsDrive("path-old",350),"250ms deadline must stay exact");
  check(!s.renew("path-old",350),"late renewal cannot revive a path");
  s.release("path-old");s.acquire("path-new",351,true);
  check(!s.admitsDrive("path-old",352),"late queued write cannot borrow new source");
  check(s.admitsDrive("path-new",352),"new source has its own deadline");
  s.acquire("dome",352,false);check(!s.admitsDrive("dome",353),"unrelated dome lease cannot authorize wheels");
  check(s.renew("path-new",500),"actual scheduler progress renews current path");
  check(s.admitsDrive("path-new",749),"renewed source remains valid before deadline");
  check(!s.admitsDrive("path-new",750),"stalled scheduler is still stopped at250ms");
  s.clear();check(!s.admitsDrive("path-new",600),"STOP retires queued drive ownership");
  System.out.println("Drive source deadlines:250ms, scoped ownership and stale-write rejection verified");
 }
}
