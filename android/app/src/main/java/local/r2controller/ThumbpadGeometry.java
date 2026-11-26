package local.r2controller;
/** The touch gate and drawing share a stationary, centered joystick circle. */
public final class ThumbpadGeometry {
 private ThumbpadGeometry() {}
 public static float radius(float width,float height){return Math.max(1,Math.min(width,height)*.40f);}
 public static boolean contains(float width,float height,float x,float y){float dx=x-width/2,dy=y-height/2,r=radius(width,height);return dx*dx+dy*dy<=r*r;}
}
