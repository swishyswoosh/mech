package local.r2controller;
/** Contact is always zero. Only the captured pointer's subsequent displacement drives. */
public final class RelativeThumbpad {
 private int owner=-1;private float x,y;
 public float[] begin(int pointer,float x,float y){if(owner!=-1)return null;owner=pointer;this.x=x;this.y=y;return new float[]{0,0};}
 public float[] move(int pointer,float x,float y,float radius){if(owner!=pointer||radius<=0)return null;float dx=(x-this.x)/radius,dy=(this.y-y)/radius;float distance=(float)Math.hypot(dx,dy);if(!Float.isFinite(distance)||distance<=.08f)return new float[]{0,0};float magnitude=(Math.min(1,distance)-.08f)/.92f;magnitude*=magnitude;return new float[]{dx/distance*magnitude,dy/distance*magnitude};}
 public void clear(){owner=-1;x=y=0;}
}
