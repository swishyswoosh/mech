package local.r2controller;

/** Monotonic-time lease; owned by the radio worker, independent of the JS event loop. */
final class SafetyLease {
  static final int APPLICATION_TIMEOUT_MS = 5000;
  private final int maximumTimeoutMs;
  SafetyLease(){this(1000);}
  SafetyLease(int maximumTimeoutMs){this.maximumTimeoutMs=maximumTimeoutMs;}
  private long lastBeat;
  private int duration;
  void arm(long now,int timeoutMs) {
    if(timeoutMs<150||timeoutMs>maximumTimeoutMs)throw new IllegalArgumentException("Safety lease must be 150.."+maximumTimeoutMs+" ms");
    duration=timeoutMs;lastBeat=now;
  }
  void heartbeat(long now){lastBeat=now;}
  boolean expired(long now){return duration>0 && now-lastBeat>=duration;}
  void disarm(){duration=0;}
}
