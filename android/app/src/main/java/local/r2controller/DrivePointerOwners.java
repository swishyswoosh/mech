package local.r2controller;
/** One pointer per control. Neither a second thumb nor a stray third touch can steal an owner. */
public final class DrivePointerOwners {
 public static final int PAD=0,SPEED=1;
 private final int[] owners={-1,-1};
 public boolean begin(int control,int pointer){if(pointer<0||owners[control]!=-1||owners[1-control]==pointer)return false;owners[control]=pointer;return true;}
 public boolean owns(int control,int pointer){return pointer>=0&&owners[control]==pointer;}
 public int owner(int control){return owners[control];}
 public boolean end(int control,int pointer){if(!owns(control,pointer))return false;owners[control]=-1;return true;}
 public void clear(){owners[0]=-1;owners[1]=-1;}
}
