import local.r2controller.DrivePointerOwners;
import local.r2controller.SliderScale;
import local.r2controller.RelativeThumbpad;
import local.r2controller.ThumbpadGeometry;
public final class NativeInputTest {
 public static void main(String[] args){
  if(!ThumbpadGeometry.contains(200,200,100,100)||ThumbpadGeometry.contains(200,200,0,0)||ThumbpadGeometry.contains(200,200,190,100))throw new AssertionError("Only the stationary joystick circle may engage drive");
  if(ThumbpadGeometry.radius(200,200)!=80f)throw new AssertionError("Joystick radius must match its fixed display");
  RelativeThumbpad pad=new RelativeThumbpad();float[] zero=pad.begin(7,15,180);if(zero[0]!=0||zero[1]!=0)throw new AssertionError("Touch down moved the droid");float[] moved=pad.move(7,65,130,100);if(Math.abs(moved[0]-.328542f)>.00001f||Math.abs(moved[1]-.328542f)>.00001f)throw new AssertionError("Radial expo deflection");float[] dead=pad.move(7,23,180,100);if(dead[0]!=0||dead[1]!=0)throw new AssertionError("8 percent deadzone");float[] edge=pad.move(7,215,180,100);if(edge[0]!=1||edge[1]!=0)throw new AssertionError("Radial clamp");if(pad.begin(8,200,0)!=null||pad.move(8,0,0,100)!=null)throw new AssertionError("Extra touch stole origin");pad.clear();if(pad.move(7,200,0,100)!=null)throw new AssertionError("Focus cancellation retained origin");
  DrivePointerOwners owners=new DrivePointerOwners();
  if(!owners.begin(DrivePointerOwners.PAD,4)||!owners.begin(DrivePointerOwners.SPEED,9))throw new AssertionError("Two independent thumbs must be accepted");
  if(owners.begin(DrivePointerOwners.PAD,12)||owners.begin(DrivePointerOwners.SPEED,12))throw new AssertionError("Third pointer stole a control");
  if(owners.end(DrivePointerOwners.PAD,9)||!owners.owns(DrivePointerOwners.PAD,4))throw new AssertionError("Speed release changed pad owner");
  if(!owners.end(DrivePointerOwners.SPEED,9)||!owners.owns(DrivePointerOwners.PAD,4))throw new AssertionError("Speed release canceled held demand");
  if(!owners.end(DrivePointerOwners.PAD,4)||owners.owner(DrivePointerOwners.PAD)!=-1)throw new AssertionError("Pad release did not zero its owner");
  if(!owners.begin(DrivePointerOwners.SPEED,2)||owners.begin(DrivePointerOwners.PAD,2))throw new AssertionError("One pointer claimed two controls");
  owners.clear();if(owners.owner(DrivePointerOwners.PAD)!=-1||owners.owner(DrivePointerOwners.SPEED)!=-1)throw new AssertionError("Cancellation retained owners");
  SliderScale dome=new SliderScale(-160,180,1);if(dome.maximumProgress()!=340||dome.value(0)!=-160||dome.value(340)!=180||dome.progress(0)!=160)throw new AssertionError("Dome scale/endpoints");
  if(dome.progress(-999)!=0||dome.progress(999)!=340)throw new AssertionError("Slider must clamp draft values");
  SliderScale speed=new SliderScale(0,100,1);if(speed.value(25)!=25||speed.value(0)!=0||speed.value(100)!=100)throw new AssertionError("Speed scale");
  try{new SliderScale(0,100,0);throw new AssertionError("Zero step accepted");}catch(IllegalArgumentException expected){}
  System.out.println("Native pointer ownership and slider checks passed");
 }
}
