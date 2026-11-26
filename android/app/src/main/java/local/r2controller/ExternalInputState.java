package local.r2controller;
import java.util.HashMap;
import java.util.Map;
/** Hardware edge state only. An unknown LB state is conservatively held until UP. */
public final class ExternalInputState {
 public static final long STALE_MS=250;
 private final Map<Integer,Boolean> buttons=new HashMap<>();
 private int selected=-1;private boolean active,observed;private long lastHardwareAt;private float x,y;
 public void observeButton(int device,boolean down,long at){buttons.put(device,down);if(active&&selected==device){observed=true;lastHardwareAt=at;if(!down){x=0;y=0;}}}
 public void start(int device){selected=device;active=true;observed=false;x=0;y=0;}
 public void stop(){active=false;selected=-1;observed=false;x=0;y=0;}
 public void forget(int device){buttons.remove(device);}
 public void clearKnowledge(){buttons.clear();stop();}
 public boolean move(int device,float rawX,float rawY,float flatX,float flatY,float maximumX,float maximumY,long at){if(!active||selected!=device)return false;x=axis(rawX,flatX,maximumX);y=-axis(rawY,flatY,maximumY);observed=true;lastHardwareAt=at;return true;}
 public boolean held(){return selected>=0&&!Boolean.FALSE.equals(buttons.get(selected));}
 public boolean stale(long now){return active&&observed&&held()&&(now<lastHardwareAt||now-lastHardwareAt>STALE_MS);}
 public int device(){return selected;}
 public float x(){return x;}
 public float y(){return y;}
 public static float axis(float value,float flat,float maximum){if(!Float.isFinite(value)||!Float.isFinite(flat)||!Float.isFinite(maximum)||maximum<=0)return 0;float normalized=value/maximum,deadzone=Math.max(0,Math.min(.99f,flat/maximum)),magnitude=Math.abs(normalized);if(magnitude<=deadzone)return 0;return Math.copySign(Math.min(1,(magnitude-deadzone)/(1-deadzone)),normalized);}
}
