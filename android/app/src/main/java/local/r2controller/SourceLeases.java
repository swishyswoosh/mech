package local.r2controller;
import java.util.*;
/** Radio-thread-owned independent source deadlines. App heartbeats cannot renew these. */
final class SourceLeases {
  static final long TIMEOUT_MS=250;
  private final Map<String,Long> deadlines=new HashMap<>();
  private final Set<String> driveOwners=new HashSet<>();
  private final Set<String> retired=new HashSet<>();
  private void validate(String id){if(id==null||!id.matches("[A-Za-z0-9:._-]{1,120}"))throw new IllegalArgumentException("Invalid source lease ID");}
  void acquire(String id,long now){acquire(id,now,false);}
  void acquire(String id,long now,boolean drive){validate(id);if(deadlines.containsKey(id)||retired.contains(id))throw new IllegalStateException("Source lease ID already active or retired");if(deadlines.size()>=32||retired.size()>=4096)throw new IllegalStateException("Source lease capacity reached; restart app");deadlines.put(id,now+TIMEOUT_MS);if(drive)driveOwners.add(id);}
  boolean renew(String id,long now){Long deadline=deadlines.get(id);if(deadline==null||now>=deadline)return false;deadlines.put(id,now+TIMEOUT_MS);return true;}
  boolean admitsDrive(String id,long now){Long deadline=deadlines.get(id);return driveOwners.contains(id)&&deadline!=null&&now<deadline;}
  boolean contains(String id){return deadlines.containsKey(id);}
  void release(String id){validate(id);deadlines.remove(id);driveOwners.remove(id);retired.add(id);}
  String expired(long now){for(Map.Entry<String,Long> entry:deadlines.entrySet())if(now>=entry.getValue())return entry.getKey();return null;}
  long delay(long now){long earliest=Long.MAX_VALUE;for(long deadline:deadlines.values())earliest=Math.min(earliest,deadline);return earliest==Long.MAX_VALUE?-1:Math.max(1,earliest-now);}
  void clear(){retired.addAll(deadlines.keySet());deadlines.clear();driveOwners.clear();}
}
