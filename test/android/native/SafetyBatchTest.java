package local.r2controller;
public class SafetyBatchTest {
  private static void check(boolean condition){if(!condition)throw new AssertionError();}
  public static void main(String[] args){
    SafetyBatch batch=new SafetyBatch();check(!batch.pending());
    batch.waitingForRadio();check(batch.pending());
    batch.begin(4);for(int i=0;i<3;i++){check(!batch.completedWrite());check(batch.pending());}
    check(batch.completedWrite());check(!batch.pending());
    batch.begin(2);check(!batch.completedWrite());batch.reset();check(!batch.pending());
    try{batch.completedWrite();throw new AssertionError("Late completion accepted");}catch(IllegalStateException expected){}
    System.out.println("SafetyBatch: success follows final acknowledged write; failure reset cannot become success");
  }
}
