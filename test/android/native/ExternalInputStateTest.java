import local.r2controller.ExternalInputState;
public final class ExternalInputStateTest {
 public static void main(String[] args){
  ExternalInputState input=new ExternalInputState();input.start(7);if(!input.held())throw new AssertionError("Unknown LB falsely released");if(input.x()!=0||input.y()!=0)throw new AssertionError("Activation invented movement");
  input.observeButton(7,true,0);input.start(7);if(!input.held())throw new AssertionError("Preheld LB became released");input.observeButton(7,false,10);if(input.held())throw new AssertionError("Physical release not observed");input.observeButton(7,true,20);if(!input.held())throw new AssertionError("Fresh down lost");
  if(!input.move(7,.55f,-.55f,.1f,.1f,1,1,30)||Math.abs(input.x()-.5f)>.0001||Math.abs(input.y()-.5f)>.0001)throw new AssertionError("Axis signs/deadzone normalization");
  if(input.move(8,1,1,0,0,1,1,300))throw new AssertionError("Other device stole input");if(!input.stale(281))throw new AssertionError("Stale hardware retained held demand");
  input.observeButton(7,false,282);if(input.stale(5000)||input.x()!=0||input.y()!=0)throw new AssertionError("Released input retained stale axes");
  input.observeButton(7,true,9000);if(!input.stale(8000))throw new AssertionError("Future hardware timestamp accepted");input.observeButton(7,false,9001);
  input.stop();if(input.move(7,1,1,0,0,1,1,9000)||input.device()!=-1)throw new AssertionError("Stopped input accepted axes");input.start(7);if(input.held())throw new AssertionError("Known physical release lost on activation");input.clearKnowledge();input.start(7);if(!input.held())throw new AssertionError("Focus loss retained release authorization");
  if(ExternalInputState.axis(Float.NaN,0,1)!=0||ExternalInputState.axis(.05f,.1f,1)!=0||ExternalInputState.axis(2,0,1)!=1)throw new AssertionError("Axis finite/range/deadzone safety");
  System.out.println("External gamepad edge, stale, focus and axis checks passed");
 }
}
