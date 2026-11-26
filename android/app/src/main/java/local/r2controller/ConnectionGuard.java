package local.r2controller;

/** Invalidates deadlines belonging to a previous GATT attempt. Radio-thread owned. */
final class ConnectionGuard {
  private long generation;
  long begin(){return ++generation;}
  void invalidate(){generation++;}
  boolean current(long token){return generation==token;}
}
