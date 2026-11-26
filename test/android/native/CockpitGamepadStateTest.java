import local.r2controller.CockpitGamepadState;
public final class CockpitGamepadStateTest {
 public static void main(String[] args){
  CockpitGamepadState state=new CockpitGamepadState();state.start(4);
  if(state.hasSample())throw new AssertionError("Startup invented a hardware sample");
  if(state.button(5,0,true,100)||state.hasSample())throw new AssertionError("Another device changed controls");
  state.button(4,1,true,99);if(state.hasSample())throw new AssertionError("Button event invented neutral unobserved axes");state.button(4,1,false,99);
  state.axes(4,.5f,-.25f,.75f,-.5f,100);
  if(state.at()!=100||state.axes()[2]!=.75f||state.buttons()[0])throw new AssertionError("Axes not preserved");
  if(!state.button(4,0,true,110)||!state.buttons()[0]||state.at()!=110)throw new AssertionError("A press lost");
  if(state.button(4,0,false,109)||!state.buttons()[0])throw new AssertionError("Delayed button replayed");
  if(!state.stale(411)||state.stale(410))throw new AssertionError("Hardware timestamp was renewed by a read");
  state.button(4,0,false,412);if(state.buttons()[0])throw new AssertionError("Release lost");
  state.button(4,12,true,413);state.hat(4,0,0,414);if(!state.buttons()[12])throw new AssertionError("Neutral hat canceled physical D-pad key");
  state.button(4,12,false,415);state.hat(4,1,0,416);if(!state.buttons()[15])throw new AssertionError("Hat-only right button missing");
  if(state.axes(4,Float.NaN,0,0,0,417)||state.at()!=416)throw new AssertionError("Invalid hardware became fresh neutral");
  state.stop();if(state.hasSample()||state.button(4,0,true,500))throw new AssertionError("Stopped input survived");
  System.out.println("Cockpit raw gamepad hardware state passed");
 }
}
