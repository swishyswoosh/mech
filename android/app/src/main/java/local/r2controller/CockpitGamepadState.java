package local.r2controller;
/** Raw standard-mapped controls. Sampling does not renew hardware freshness. */
public final class CockpitGamepadState {
 private int device=-1;private long at=-1;private boolean axesObserved;
 private float[] axes=new float[4];private boolean[] buttons=new boolean[17];private boolean[] hats=new boolean[4];
 public void start(int selected){stop();device=selected;}
 public void stop(){device=-1;at=-1;axesObserved=false;axes=new float[4];buttons=new boolean[17];hats=new boolean[4];}
 public boolean button(int selected,int button,boolean pressed,long timestamp){if(selected!=device||device<0||button<0||button>=17||timestamp<at)return false;buttons[button]=pressed;at=timestamp;return true;}
 public boolean axes(int selected,float x,float y,float rx,float ry,long timestamp){if(selected!=device||device<0||timestamp<at||!Float.isFinite(x)||!Float.isFinite(y)||!Float.isFinite(rx)||!Float.isFinite(ry))return false;axesObserved=true;axes=new float[]{clamp(x),clamp(y),clamp(rx),clamp(ry)};at=timestamp;return true;}
 private static float clamp(float value){return Float.isFinite(value)?Math.max(-1,Math.min(1,value)):0;}
 public int device(){return device;}
 public long at(){return at;}
 public boolean hasSample(){return at>=0&&axesObserved;}
 public boolean stale(long now){return hasSample()&&(now<at||now-at>300);}
 public float[] axes(){return axes.clone();}
 public boolean hat(int selected,float x,float y,long timestamp){if(selected!=device||device<0||timestamp<at||!Float.isFinite(x)||!Float.isFinite(y))return false;hats=new boolean[]{y<-.5f,y>.5f,x<-.5f,x>.5f};at=timestamp;return true;}
 public boolean[] buttons(){boolean[] result=buttons.clone();for(int i=0;i<4;i++)result[12+i]|=hats[i];return result;}
}
