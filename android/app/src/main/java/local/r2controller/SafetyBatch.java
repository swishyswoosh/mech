package local.r2controller;

/** Completion follows acknowledged GATT writes, not a wall-clock success timer. */
final class SafetyBatch {
  private int remaining;
  void waitingForRadio(){remaining=-1;}
  void begin(int writes){if(writes<=0)throw new IllegalArgumentException("No safety writes");remaining=writes;}
  boolean completedWrite(){if(remaining<=0)throw new IllegalStateException("No pending safety write");return --remaining==0;}
  boolean pending(){return remaining!=0;}
  void reset(){remaining=0;}
}
