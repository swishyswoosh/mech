package local.r2controller;
import android.content.SharedPreferences;
import java.util.Map;
import java.util.Objects;
import java.util.WeakHashMap;
/** Acknowledged snapshots, isolated from radio/safety work and stale React hosts. */
final class BatteryProfilingStorage {
 static final String KEY="battery.profiling.v1";
 private static final Object WRITES=new Object();
 private static final Map<SharedPreferences,String> committed=new WeakHashMap<>();
 private BatteryProfilingStorage() {}
 static synchronized String load(SharedPreferences preferences){
  if(!committed.containsKey(preferences))committed.put(preferences,preferences.getString(KEY,null));
  return committed.get(preferences);
 }
 private static synchronized void remember(SharedPreferences preferences,String value){committed.put(preferences,value);}
 static void commit(SharedPreferences preferences,String value,String expected){
  if(value==null||LocalContent.utf8Size(value)>1500000)throw new IllegalArgumentException("Battery profiling storage is full");
  synchronized(WRITES){
   String previous=load(preferences);
   if(!Objects.equals(previous,expected))throw new IllegalStateException("Battery profiling data changed in another session");
   boolean saved=false;
   try{saved=preferences.edit().putString(KEY,value).commit();}
   finally{if(!saved){SharedPreferences.Editor restore=preferences.edit();if(previous==null)restore.remove(KEY);else restore.putString(KEY,previous);restore.apply();}}
   if(!saved)throw new IllegalStateException("Battery profiling disk commit failed");
   remember(preferences,value);
  }
 }
}
