package local.r2controller;
import java.util.*;
/** A pulse has a fixed 200 ms owner deadline and deliberately has no renewal API. */
final class FixedPulseDeadline {
 private String owner;private long deadline;private boolean admitted,started;private final Set<String> retired=new HashSet<>();
 void arm(String id,long now){if(id==null||!id.matches("[A-Za-z0-9:._-]{1,120}"))throw new IllegalArgumentException("Invalid pulse ID");if(owner!=null||retired.contains(id))throw new IllegalStateException("Pulse owner is active or retired");owner=id;deadline=now+200;admitted=false;started=false;}
 boolean active(){return owner!=null;}
 boolean matches(String id){return owner!=null&&owner.equals(id);}
 boolean admitWrite(String id,long now){if(!matches(id)||now>=deadline||admitted)return false;admitted=true;return true;}
 boolean startWrite(String id,long now){if(!matches(id)||now>=deadline||!admitted||started)return false;started=true;return true;}
 boolean expire(String id,long now){return matches(id)&&now>=deadline&&cancel(id);}
 boolean cancel(String id){if(!matches(id))return false;retired.add(owner);owner=null;return true;}
 void clear(){if(owner!=null)cancel(owner);}
}
