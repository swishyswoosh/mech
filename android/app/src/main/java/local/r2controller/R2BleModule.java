package local.r2controller;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.app.Activity;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.os.*;
import android.util.Base64;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.InputStream;
import java.io.OutputStream;
/** Serial GATT transport. Protocol initialization and response matching live in shared TS. */
public final class R2BleModule extends ReactContextBaseJavaModule implements LifecycleEventListener {
  private final HandlerThread thread = new HandlerThread("r2-radio-safety");
  private final Handler radio;
  // Separate preference writes keep disk latency off radio callbacks, lease expiry, and STOP.
  private final ExecutorService preferenceWrites = Executors.newSingleThreadExecutor(
      task -> new Thread(task, "r2-preference-storage"));
  private final BluetoothAdapter adapter;
  private BluetoothGatt gatt;
  private Promise connectPromise;
  private Promise documentPromise;
  private boolean documentMultiple;
  private Promise exportPromise;
  private String exportText;
  private static final int LOCAL_JSON_REQUEST = 8271;
  private static final int EXPORT_JSON_REQUEST = 8272;
  private void documentResult(int requestCode, int resultCode, Intent data) {
    if (requestCode == EXPORT_JSON_REQUEST) {
      final Promise pending = exportPromise;
      final String text = exportText;
      exportPromise = null;
      exportText = null;
      if (pending == null) return;
      if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
        pending.reject("LOCAL_CONTENT", "Local file export cancelled");
        return;
      }
      new Thread(() -> {
        try {
          LocalContent.commitJson(getReactApplicationContext().getContentResolver().openOutputStream(data.getData(), "wt"), text);
          pending.resolve(null);
        } catch (Exception error) {
          pending.reject("LOCAL_CONTENT", error.toString());
        }
      }, "r2-local-export").start();
      return;
    }
    if (requestCode != LOCAL_JSON_REQUEST) return;
    final Promise pending = documentPromise;
    final boolean multiple = documentMultiple;
    documentPromise = null;
    if (pending == null) return;
    if (resultCode != Activity.RESULT_OK || data == null || (data.getData() == null && data.getClipData() == null)) {
      pending.reject("LOCAL_CONTENT", "Local file selection cancelled");
      return;
    }
    // Local document reads run outside both the UI thread and radio/safety handler.
    new Thread(() -> {
      try {
        ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
          for (int i = 0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
        } else uris.add(data.getData());
        if (uris.size()>3) throw new IllegalArgumentException("Choose at most three local JSON files");
        WritableArray files = Arguments.createArray();
        String first = null;
        int size = 0;
        for (Uri uri:uris) {
          String text;
          try(InputStream stream = getReactApplicationContext().getContentResolver().openInputStream(uri)) {
            if (stream == null) throw new IllegalStateException("Selected local document is unavailable");
            text = LocalContent.readJson(stream);
          }
          size += LocalContent.utf8Size(text);
          if (size>2_000_000) throw new IllegalArgumentException("Selected files exceed 2 MB in total");
          if (first == null) first = text;
          String name = "local.json";
          try(Cursor cursor = getReactApplicationContext().getContentResolver().query(uri, new String[] {
            OpenableColumns.DISPLAY_NAME
          }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
          }
          WritableMap file = Arguments.createMap();
          file.putString("name", name);
          file.putString("text", text);
          files.pushMap(file);
        }
        pending.resolve(multiple ? files:first);
      } catch (Exception error) {
        pending.reject("LOCAL_CONTENT", error.toString());
      }
    }, "r2-local-import").start();
  }
  private final ConnectionGuard connections = new ConnectionGuard();
  private final ConnectionGuard safetyBatches = new ConnectionGuard();
  private boolean foreground;
  private boolean resumeAfterSafety;
  private String safetyEscalation;
  private PendingStop pendingStop;
  private static final class PendingStop {
    final String why;
    final UUID service;
    final byte[] frame;
    final Promise promise;
    PendingStop(String w, UUID s, byte[] f, Promise p) {
      why = w;
      service = s;
      frame = f;
      promise = p;
    }
  }
  private UUID safetyService;
  private Promise safetyPromise;
  private final SafetyBatch safetyBatch = new SafetyBatch();
  private boolean closeAfterSafety;
  private String safetyReason;
  private final ArrayDeque<Op> queue = new ArrayDeque<>();
  private Op active;
  private boolean scanning, closing, emergency;
  private long scanGeneration;
  private byte[] stopFrame;
  private final SafetyLease lease = new SafetyLease();
  private final SafetyLease manualLease = new SafetyLease();
  private final FixedPulseDeadline pulseDeadline = new FixedPulseDeadline();
  private boolean manualInputAllowed = true;
  private PulseOperation pulseOperation;
  private String pulseBatchOwner;
  private static final class PulseOperation {
    final String id;
    final UUID service;
    final byte[] demand;
    final byte[] zero;
    Promise waiter;
    boolean done;
    String error;
    PulseOperation(String i, UUID s, byte[] d, byte[] z) {
      id = i;
      service = s;
      demand = d;
      zero = z;
    }
  }
  private final SourceLeases sourceLeases = new SourceLeases();
  private static final UUID API = UUID.fromString("00010002-574f-4f20-5370-6865726f2121");
  private static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
  private static final class Op {
    final String kind;
    final UUID service;
    final UUID uuid;
    final byte[] bytes;
    final boolean response;
    final Promise promise;
    final String pulseOwner;
    final String driveOwner;
    boolean safety;
    Op(String k, UUID s, UUID u, byte[] b, boolean r, Promise p) {
      this(k, s, u, b, r, p, "");
    }
    Op(String k, UUID s, UUID u, byte[] b, boolean r, Promise p, String owner) {
      this(k, s, u, b, r, p, owner, "");
    }
    Op(String k, UUID s, UUID u, byte[] b, boolean r, Promise p, String owner, String drive) {
      driveOwner = drive == null ? "":drive;
      kind = k;
      service = s;
      uuid = u;
      bytes = b;
      response = r;
      promise = p;
      pulseOwner = owner == null ? "":owner;
    }
  }
  R2BleModule(ReactApplicationContext c) {
    super(c);
    thread.start();
    radio = new Handler(thread.getLooper());
    BluetoothManager manager = (BluetoothManager) c.getSystemService(Context.BLUETOOTH_SERVICE);
    adapter = manager == null ? null : manager.getAdapter();
    foreground = c.getLifecycleState() == LifecycleState.RESUMED;
    c.addLifecycleEventListener(this);
  }
  @Override public String getName() {
    return "R2Ble";
  }
  @Override public Map<String, Object> getConstants() {
    Map<String, Object> out = new HashMap<>();
    out.put("preferences", getReactApplicationContext().getSharedPreferences("controller", Context.MODE_PRIVATE).getAll());
    return out;
  }
  @ReactMethod public void savePreference(String key, String value, Promise promise) {
    persistPreference("PREFERENCE_STORAGE", promise, () -> {
      SharedPreferences preferences = getReactApplicationContext().getSharedPreferences("controller", Context.MODE_PRIVATE);
      String previous = preferences.getString(key, null);
      boolean saved = false;
      try {
        saved = preferences.edit().putString(key, value).commit();
      } finally {
        // commit() can change SharedPreferences' memory even when disk fails.
        // Cache restoration before rejection prevents a later host from loading the rejected draft.
        if (!saved) {
          SharedPreferences.Editor restore = preferences.edit();
          if (previous == null) restore.remove(key);
          else restore.putString(key, previous);
          restore.apply();
        }
      }
      if (!saved) throw new IllegalStateException("Preference disk commit failed");
    });
  }
  private void persistPreference(String code, Promise promise, Runnable write) {
    try {
      preferenceWrites.execute(() -> {
        try {
          write.run();
          promise.resolve(null);
        }
        catch (Exception error) {
          promise.reject(code, error.toString());
        }
      });
    } catch (java.util.concurrent.RejectedExecutionException error) {
      promise.reject(code, "Preference storage host is closed");
    }
  }
  @ReactMethod(isBlockingSynchronousMethod = true) public String loadBatteryProfiling() {
    return BatteryProfilingStorage.load(getReactApplicationContext().getSharedPreferences("controller", Context.MODE_PRIVATE));
  }
  @ReactMethod public void saveBatteryProfiling(String value, String expected, Promise promise) {
    persistPreference("BATTERY_PROFILING", promise, () -> BatteryProfilingStorage.commit(
        getReactApplicationContext().getSharedPreferences("controller", Context.MODE_PRIVATE), value, expected));
  }
  @ReactMethod public void importLocalJson(Promise promise) {
    openLocalJson(false, promise);
  }
  @ReactMethod public void importLocalJsonFiles(Promise promise) {
    openLocalJson(true, promise);
  }
  private void openLocalJson(boolean multiple, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      if (documentPromise != null || exportPromise != null) {
        promise.reject("LOCAL_CONTENT", "A local file picker is already open");
        return;
      }
      Activity activity = getReactApplicationContext().getCurrentActivity();
      if (activity == null) {
        promise.reject("LOCAL_CONTENT", "No foreground activity for local file picker");
        return;
      }
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("*/*");
      intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
        "application/json", "text/json", "text/plain"
      });
      intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
      documentMultiple = multiple;
      documentPromise = promise;
      try {
        ((MainActivity) activity).launchDocument(intent, result -> documentResult(LOCAL_JSON_REQUEST, result.getResultCode(), result.getData()));
      } catch (Exception error) {
        documentPromise = null;
        promise.reject("LOCAL_CONTENT", error.toString());
      }
    });
  }
  @ReactMethod public void exportLocalJson(String name, String text, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      if (documentPromise != null || exportPromise != null) {
        promise.reject("LOCAL_CONTENT", "A local file picker is already open");
        return;
      }
      Activity activity = getReactApplicationContext().getCurrentActivity();
      if (activity == null) {
        promise.reject("LOCAL_CONTENT", "No foreground activity for export");
        return;
      }
      if (LocalContent.utf8Size(text)>2_000_000) {
        promise.reject("LOCAL_CONTENT", "Local JSON export is limited to 2 MB");
        return;
      }
      Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("application/json");
      intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
      intent.putExtra(Intent.EXTRA_TITLE, name.replaceAll("[^A-Za-z0-9._-]", "_"));
      exportPromise = promise;
      exportText = text;
      try {
        ((MainActivity) activity).launchDocument(intent, result -> documentResult(EXPORT_JSON_REQUEST, result.getResultCode(), result.getData()));
      } catch (Exception error) {
        exportPromise = null;
        exportText = null;
        promise.reject("LOCAL_CONTENT", error.toString());
      }
    });
  }
  @ReactMethod public void hashLocalText(String text, Promise promise) {
    new Thread(() -> {
      try {
        WritableMap out = Arguments.createMap();
        out.putString("sha256", LocalContent.sha256(text));
        out.putInt("bytes", LocalContent.utf8Size(text));
        promise.resolve(out);
      } catch (Exception error) {
        promise.reject("LOCAL_CONTENT", error.toString());
      }
    }, "r2-local-hash").start();
  }
  @ReactMethod public void addListener(String event) {}
  @ReactMethod public void removeListeners(double count) {}
  private void emit(String name, WritableMap data) {
    if (getReactApplicationContext().hasActiveReactInstance()) getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(name, data);
  }
  private void state(String s, String reason) {
    state(s, reason, false);
  }
  private void state(String s, String reason, boolean appOwned) {
    android.util.Log.i("R2Ble", s + ": " + reason);
    WritableMap d = Arguments.createMap();
    d.putString("state", s);
    d.putString("reason", reason);
    d.putBoolean("appOwned", appOwned);
    emit("R2BleState", d);
  }
  private void reject(Promise p, String message) {
    if (p != null) p.reject("BLE", message);
  }
  private boolean enabled(Promise p) {
    if (!foreground) {
      reject(p, "App is not in foreground");
      return false;
    }
    if (adapter == null || !adapter.isEnabled()) {
      reject(p, "Bluetooth is unavailable or disabled");
      return false;
    }
    return true;
  }
  private final ScanCallback scanner = new ScanCallback() {
    @Override public void onScanResult(int type, ScanResult result) {
      radio.post(() -> {
        try {
          WritableMap d = Arguments.createMap();
          d.putString("id", result.getDevice().getAddress());
          ScanRecord record = result.getScanRecord();
          String name = record == null ? null:record.getDeviceName();
          d.putString("name", name == null ? result.getDevice().getName():name);
          d.putInt("rssi", result.getRssi());
          WritableArray services = Arguments.createArray();
          if (record != null && record.getServiceUuids() != null) for (ParcelUuid uuid:record.getServiceUuids()) services.pushString(uuid.toString());
          d.putArray("serviceUuids", services);
          emit("R2BleDevice", d);
        } catch (SecurityException e) {
          state("failed", e.toString());
        }
      });
    }
    @Override public void onScanFailed(int error) {
      radio.post(() -> {
        scanning = false;
        state("failed", "Scan failed: " + error);
      });
    }
  };
  @ReactMethod public void scan(Promise p) {
    radio.post(() -> {
      try {
        if (!enabled(p)) return;
        stopScanning();
        adapter.getBluetoothLeScanner().startScan(scanner);
        scanning = true;
        state("scanning", "");
        final long scan = scanGeneration;
        radio.postDelayed(() -> {
          if (scanGeneration == scan) stopScanning();
        }, 15000);
        p.resolve(null);
      } catch (Exception e) {
        reject(p, e.toString());
      }
    });
  }
  private void stopScanning() {
    scanGeneration++;
    if (scanning) {
      scanning = false;
      try {
        if (adapter != null && adapter.getBluetoothLeScanner() != null) adapter.getBluetoothLeScanner().stopScan(scanner);
      } catch (SecurityException e) {
        state("failed", e.toString());
      }
    }
  }
  @ReactMethod public void stopScan(Promise p) {
    radio.post(() -> {
      stopScanning();
      p.resolve(null);
    });
  }
  @ReactMethod public void connect(String id, Promise p) {
    radio.post(() -> {
      try {
        if (!enabled(p)) return;
        if (gatt != null) {
          reject(p, "Disconnect the current droid first");
          return;
        }
        stopScanning();
        closing = false;
        emergency = false;
        connectPromise = p;
        final long attempt = connections.begin();
        state("connecting", "");
        gatt = GattConnection.connect(adapter.getRemoteDevice(id), getReactApplicationContext(), radio, callback);
        radio.postDelayed(() -> {
          if (connections.current(attempt) && connectPromise == p) {
            reject(connectPromise, "Connection timed out");
            connectPromise = null;
            close("Connection timed out");
          }
        }, 15000);
      } catch (SecurityException e) {
        reject(p, "Bluetooth permission revoked");
        connectPromise = null;
        close("Bluetooth permission revoked");
      }
      catch (Exception e) {
        reject(p, e.toString());
        connectPromise = null;
        close(e.toString());
      }
    });
  }
  private BluetoothGattCharacteristic find(UUID service, UUID uuid) {
    if (gatt == null || service == null) return null;
    BluetoothGattService found = gatt.getService(service);
    return found == null ? null:found.getCharacteristic(uuid);
  }
  @ReactMethod public void discover(Promise p) {
    enqueue(new Op("discover", null, null, null, true, p));
  }
  @ReactMethod public void read(String service, String uuid, Promise p) {
    try {
      enqueue(new Op("read", UUID.fromString(service), UUID.fromString(uuid), null, true, p));
    } catch (Exception e) {
      reject(p, e.toString());
    }
  }
  @ReactMethod public void write(String service, String uuid, String base64, boolean response, String pulseOwner, String driveOwner, Promise p) {
    try {
      enqueue(new Op("write", UUID.fromString(service), UUID.fromString(uuid), Base64.decode(base64, Base64.DEFAULT), response, p, pulseOwner, driveOwner));
    } catch (Exception e) {
      reject(p, e.toString());
    }
  }
  @ReactMethod public void subscribe(String service, String uuid, Promise p) {
    try {
      enqueue(new Op("subscribe", UUID.fromString(service), UUID.fromString(uuid), null, true, p));
    } catch (Exception e) {
      reject(p, e.toString());
    }
  }
  private boolean pulseWriteMatches(Op op) {
    return pulseOperation != null && !pulseOperation.done && pulseOperation.id.equals(op.pulseOwner)
        && API.equals(op.uuid) && pulseOperation.service.equals(op.service)
        && Arrays.equals(pulseOperation.demand, op.bytes);
  }
  private void enqueue(Op op) {
    radio.post(() -> {
      if (!BackgroundGattPolicy.allows(foreground,
          "write".equals(op.kind) && API.equals(op.uuid) && op.service != null && op.service.equals(safetyService),
          !op.pulseOwner.isEmpty(), op.bytes) || closing || emergency || gatt == null) {
        reject(op.promise, "Connection unavailable");
        return;
      }
      if (!op.pulseOwner.isEmpty() && (!pulseWriteMatches(op) || !pulseDeadline.admitWrite(op.pulseOwner, SystemClock.elapsedRealtime()))) {
        reject(op.promise, "Pulse owner expired before queue admission");
        endPulse(op.pulseOwner, true);
        return;
      }
      if (!op.driveOwner.isEmpty() && !sourceLeases.admitsDrive(op.driveOwner, SystemClock.elapsedRealtime())) {
        reject(op.promise, "Drive source expired before queue admission");
        return;
      }
      queue.add(op);
      next();
    });
  }
  private void next() {
    if (active != null || queue.isEmpty() || gatt == null) return;
    Op op = queue.remove();
    active = op;
    try {
      boolean started;
      if (op.kind.equals("discover")) {
        started = gatt.discoverServices();
      }
      else {
        BluetoothGattCharacteristic c = find(op.service, op.uuid);
        if (c == null) throw new IllegalStateException("Missing characteristic " + op.uuid);
        if (op.kind.equals("read")) started = gatt.readCharacteristic(c);
        else if (op.kind.equals("subscribe")) {
          BluetoothGattDescriptor d = c.getDescriptor(CCC);
          if (d == null) throw new IllegalStateException("Missing notification descriptor");
          if (!gatt.setCharacteristicNotification(c, true)) throw new IllegalStateException("Local notifications rejected");
          started = BluetoothCompat.subscribe(gatt, d);
        } else {
          int writeType = op.response ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
          if (!op.pulseOwner.isEmpty() && (!pulseWriteMatches(op) || !pulseDeadline.startWrite(op.pulseOwner, SystemClock.elapsedRealtime()))) {
            active = null;
            reject(op.promise, "Pulse owner expired before GATT submission");
            endPulse(op.pulseOwner, true);
            next();
            return;
          }
          if (!op.driveOwner.isEmpty() && !sourceLeases.admitsDrive(op.driveOwner, SystemClock.elapsedRealtime())) {
            active = null;
            reject(op.promise, "Drive source expired before GATT submission");
            next();
            return;
          }
          if (android.util.Log.isLoggable("R2Latency", android.util.Log.DEBUG)) android.util.Log.d("R2Latency", "write " + Base64.encodeToString(op.bytes, Base64.NO_WRAP));
          started = BluetoothCompat.write(gatt, c, op.bytes, writeType);
        }
      }
      if (!started) throw new IllegalStateException("GATT operation refused: " + op.kind);
      radio.postDelayed(() -> {
        if (active == op) {
          reject(op.promise, "GATT operation timed out: " + op.kind);
          active = null;
          close("GATT operation timed out");
        }
      }, 5000);
    } catch (SecurityException e) {
      reject(op.promise, "Bluetooth permission revoked");
      active = null;
      close("Bluetooth permission revoked");
    }
    catch (Exception e) {
      reject(op.promise, e.toString());
      active = null;
      close(e.toString());
    }
  }
  private void finish(String kind, UUID service, UUID uuid, int status, Object result) {
    if (active == null || !active.kind.equals(kind) || (uuid != null && (!uuid.equals(active.uuid) || !service.equals(active.service)))) return;
    Op op = active;
    active = null;
    if (status != BluetoothGatt.GATT_SUCCESS) {
      reject(op.promise, "GATT status " + status);
      close("GATT operation failed");
      return;
    }
    if (op.promise != null) op.promise.resolve(result);
    if (op.safety && safetyBatch.completedWrite()) {
      completeSafety();
      return;
    }
    next();
  }
  private final BluetoothGattCallback callback = new BluetoothGattCallback() {
    @Override public void onConnectionStateChange(BluetoothGatt source, int status, int newState) {
      radio.post(() -> {
        if (source != gatt) return;
        if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
          if (connectPromise != null) {
            connectPromise.resolve(null);
            connectPromise = null;
          }
          state("connected", "");
        }
        else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) close("Disconnected; GATT status " + status);
      });
    }
    @Override public void onServicesDiscovered(BluetoothGatt source, int status) {
      radio.post(() -> {
        if (source != gatt) return;
        WritableArray a = Arguments.createArray();
        for (BluetoothGattService s:source.getServices()) for (BluetoothGattCharacteristic c:s.getCharacteristics()) {
          WritableMap d = Arguments.createMap();
          d.putString("service", s.getUuid().toString());
          d.putString("characteristic", c.getUuid().toString());
          a.pushMap(d);
        }
        finish("discover", null, null, status, a);
      });
    }
    // API 26–32 delivers the value through the characteristic. From API 33 only
    // the explicit-byte overload is consumed, avoiding duplicate notifications.
    @Override @SuppressWarnings("deprecation") public void onCharacteristicRead(BluetoothGatt source, BluetoothGattCharacteristic c, int status) {
      if (android.os.Build.VERSION.SDK_INT<33) onCharacteristicRead(source, c, BluetoothCompat.notificationValue(c), status);
    }
    @Override @SuppressWarnings("deprecation") public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic c) {
      if (android.os.Build.VERSION.SDK_INT<33) onCharacteristicChanged(source, c, BluetoothCompat.notificationValue(c));
    }
    @Override public void onCharacteristicRead(BluetoothGatt source, BluetoothGattCharacteristic c, byte[] bytes, int status) {
      byte[] copy = bytes.clone();
      radio.post(() -> {
        if (source == gatt) finish("read", c.getService().getUuid(), c.getUuid(), status, Base64.encodeToString(copy, Base64.NO_WRAP));
      });
    }
    @Override public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic c, byte[] bytes) {
      byte[] copy = bytes.clone();
      radio.post(() -> {
        if (source != gatt) return;
        WritableMap d = Arguments.createMap();
        d.putString("service", c.getService().getUuid().toString());
        d.putString("uuid", c.getUuid().toString());
        d.putString("value", Base64.encodeToString(copy, Base64.NO_WRAP));
        emit("R2BleNotification", d);
      });
    }
    @Override public void onCharacteristicWrite(BluetoothGatt source, BluetoothGattCharacteristic c, int status) {
      radio.post(() -> {
        if (source == gatt) finish("write", c.getService().getUuid(), c.getUuid(), status, null);
      });
    }
    @Override public void onDescriptorWrite(BluetoothGatt source, BluetoothGattDescriptor d, int status) {
      radio.post(() -> {
        if (source == gatt) finish("subscribe", d.getCharacteristic().getService().getUuid(), d.getCharacteristic().getUuid(), status, null);
      });
    }
  };
  /** Heartbeat is a lease. JS stalls, app pause, and host teardown trigger a native stop attempt. */
  @ReactMethod public void armSafetyStop(String service, String base64, int timeoutMs, Promise p) {
    radio.post(() -> {
      try {
        byte[] frame = Base64.decode(base64, Base64.DEFAULT);
        SafetyStopFrames.validate(frame);
        if (!foreground || gatt == null || closing || emergency) throw new IllegalStateException("No usable connection");
        UUID actualService = UUID.fromString(service);
        if (find(actualService, API) == null) throw new IllegalStateException("Safety API characteristic missing from selected service");
        controlPriority(true);
        lease.arm(SystemClock.elapsedRealtime(), timeoutMs);
        safetyService = actualService;
        stopFrame = frame;
        radio.removeCallbacks(watchdog);
        radio.postDelayed(watchdog, 50);
        p.resolve(null);
      } catch (Exception e) {
        reject(p, e.toString());
      }
    });
  }
  private final Runnable manualWatchdog = () -> {
    if (stopFrame != null && manualLease.expired(SystemClock.elapsedRealtime())) requestSafetyStop("Manual source lease expired");
  };
  @ReactMethod public void rearmManualInput() {
    radio.post(() -> {
      if (!pulseDeadline.active() && foreground && !emergency) manualInputAllowed = true;
    });
  }
  @ReactMethod public void manualHeartbeat(Promise p) {
    radio.post(() -> {
      if (!manualInputAllowed || !foreground || gatt == null || stopFrame == null || emergency) {
        reject(p, "Manual source is not armed");
        return;
      }
      manualLease.arm(SystemClock.elapsedRealtime(), 250);
      radio.removeCallbacks(manualWatchdog);
      radio.postDelayed(manualWatchdog, 250);
      p.resolve(null);
    });
  }
  private void pulseEvent(String id) {
    WritableMap event = Arguments.createMap();
    event.putString("id", id);
    emit("R2BlePulseEnded", event);
  }
  private void finishPulse(String error) {
    PulseOperation pulse = pulseOperation;
    if (pulse == null || pulse.done) return;
    pulseDeadline.clear();
    pulse.done = true;
    pulse.error = error;
    manualInputAllowed = false;
    if (pulse.waiter != null) {
      if (error == null) pulse.waiter.resolve(null);
      else reject(pulse.waiter, error);
      pulse.waiter = null;
    }
  }
  private void endPulse(String id, boolean expired) {
    PulseOperation pulse = pulseOperation;
    if (pulse == null || pulse.done || !pulse.id.equals(id)) return;
    boolean ended = expired ? pulseDeadline.expire(id, SystemClock.elapsedRealtime()):pulseDeadline.cancel(id);
    if (!ended) return;
    manualInputAllowed = false;
    pulseEvent(id);
    if (gatt == null || stopFrame == null || emergency) {
      finishPulse("Pulse ended while radio unavailable");
      requestSafetyStop("Pulse zero unavailable");
      return;
    }
    pulseBatchOwner = id;
    startSafetyBatch("Fixed 200 ms pulse ended", pulse.service, pulse.zero, null, false, true);
  }
  @ReactMethod public void armDrivePulse(String id, String service, String demandBase64, String zeroBase64, Promise p) {
    radio.post(() -> {
      try {
        if (!foreground || gatt == null || stopFrame == null || emergency) throw new IllegalStateException("No armed pulse connection");
        if (pulseOperation != null && !pulseOperation.done) throw new IllegalStateException("A pulse already owns driving");
        UUID actualService = UUID.fromString(service);
        byte[] demand = Base64.decode(demandBase64, Base64.DEFAULT), zero = Base64.decode(zeroBase64, Base64.DEFAULT);
        DrivePulseFrames.validate(demand, zero);
        if (find(actualService, API) == null || zero.length == 0 || zero.length>20) throw new IllegalArgumentException("Invalid pulse zero frame");
        pulseDeadline.arm(id, SystemClock.elapsedRealtime());
        pulseOperation = new PulseOperation(id, actualService, demand, zero);
        manualInputAllowed = true;
        radio.postDelayed(() -> endPulse(id, true), 200);
        p.resolve(null);
      } catch (Exception error) {
        reject(p, error.toString());
      }
    });
  }
  @ReactMethod public void awaitDrivePulse(String id, Promise p) {
    radio.post(() -> {
      PulseOperation pulse = pulseOperation;
      if (pulse == null || !pulse.id.equals(id)) {
        reject(p, "Pulse owner changed");
        return;
      }
      if (pulse.done) {
        if (pulse.error == null) p.resolve(null);
        else reject(p, pulse.error);
      } else if (pulse.waiter != null) reject(p, "Pulse waiter already registered");
      else pulse.waiter = p;
    });
  }
  @ReactMethod public void cancelDrivePulse(String id, Promise p) {
    radio.post(() -> {
      endPulse(id, false);
      p.resolve(null);
    });
  }
  private final Runnable sourceWatchdog = () -> {
    String expired = sourceLeases.expired(SystemClock.elapsedRealtime());
    if (expired != null) requestSafetyStop("Source lease expired: " + expired);
    else scheduleSourceWatchdog();
  };
  private void scheduleSourceWatchdog() {
    radio.removeCallbacks(sourceWatchdog);
    long delay = sourceLeases.delay(SystemClock.elapsedRealtime());
    if (delay >= 0) radio.postDelayed(sourceWatchdog, delay);
  }
  private void clearSourceLeases() {
    sourceLeases.clear();
    radio.removeCallbacks(sourceWatchdog);
  }
  @ReactMethod public void acquireSourceLease(String id, boolean drive, Promise p) {
    radio.post(() -> {
      try {
        if (!foreground || gatt == null || stopFrame == null || emergency) throw new IllegalStateException("No foreground armed source connection");
        sourceLeases.acquire(id, SystemClock.elapsedRealtime(), drive);
        scheduleSourceWatchdog();
        p.resolve(null);
      } catch (Exception error) {
        reject(p, error.toString());
      }
    });
  }
  @ReactMethod public void renewSourceLease(String id) {
    radio.post(() -> {
      long now = SystemClock.elapsedRealtime();
      if (!sourceLeases.renew(id, now) && sourceLeases.contains(id)) {
        requestSafetyStop("Source lease expired: " + id);
        return;
      }
      scheduleSourceWatchdog();
    });
  }
  @ReactMethod public void releaseSourceLease(String id) {
    radio.post(() -> {
      try {
        sourceLeases.release(id);
        scheduleSourceWatchdog();
      } catch (Exception error) {
        state("failed", error.toString());
      }
    });
  }
  @ReactMethod public void manualIdleAcknowledged() {
    radio.post(() -> {
      manualLease.disarm();
      radio.removeCallbacks(manualWatchdog);
    });
  }
  @ReactMethod public void heartbeat() {
    radio.post(() -> {
      lease.heartbeat(SystemClock.elapsedRealtime());
    });
  }
  @ReactMethod public void disarmSafetyStop(Promise p) {
    radio.post(() -> {
      clearSourceLeases();
      stopFrame = null;
      lease.disarm();
      manualLease.disarm();
      radio.removeCallbacks(manualWatchdog);
      radio.removeCallbacks(watchdog);
      p.resolve(null);
    });
  }
  private final Runnable watchdog = new Runnable() {
    public void run() {
      if (stopFrame == null) return;
      if (manualLease.expired(SystemClock.elapsedRealtime())) {
        requestSafetyStop("Manual source lease expired");
        return;
      }
      if (lease.expired(SystemClock.elapsedRealtime())) {
        requestSafetyStop("Native safety lease expired");
        return;
      }
      radio.postDelayed(this, 50);
    }
  };
  private void completeSafety() {
    if (pulseBatchOwner != null) {
      String owner = pulseBatchOwner;
      pulseBatchOwner = null;
      if (pulseOperation != null && pulseOperation.id.equals(owner)) finishPulse(null);
    }
    safetyBatches.invalidate();
    Promise completion = safetyPromise;
    safetyPromise = null;
    if (resumeAfterSafety) {
      resumeAfterSafety = false;
      emergency = false;
      manualLease.disarm();
      radio.removeCallbacks(manualWatchdog);
      if (safetyEscalation != null) {
        String why = safetyEscalation;
        safetyEscalation = null;
        PendingStop pending = pendingStop;
        pendingStop = null;
        if (completion != null) completion.resolve(null);
        if (pending != null) startSafetyBatch(pending.why, pending.service, pending.frame, pending.promise, closeAfterSafety, false);
        else safetyStop(why, null, closeAfterSafety);
        return;
      }
    }
    if (closeAfterSafety) {
      if (completion != null) completion.resolve(null);
      close(safetyReason);
      return;
    }
    // GATT completion releases the STOP barrier, never the motion latch.
    if (!foreground) controlPriority(false);
    emergency = false;
    manualInputAllowed = false;
    if (stopFrame != null && foreground) {
      lease.arm(SystemClock.elapsedRealtime(), 500);
      radio.removeCallbacks(watchdog);
      radio.postDelayed(watchdog, 50);
    }
    if (completion != null) completion.resolve(null);
    PendingStop pending = pendingStop;
    pendingStop = null;
    if (pending != null) startSafetyBatch(pending.why, pending.service, pending.frame, pending.promise, false, false);
  }
  private void requestSafetyStop(String why) {
    requestSafetyStop(why, false);
  }
  private void requestSafetyStop(String why, boolean shouldClose) {
    clearSourceLeases();
    if (emergency) {
      closeAfterSafety|=shouldClose;
      if (resumeAfterSafety) {
        safetyEscalation = why;
        return;
      }
      if (shouldClose && !safetyBatch.pending()) close(why);
      return;
    }
    if (gatt == null) return;
    if (stopFrame == null) {
      close(why + " before native safety was armed");
      return;
    }
    safetyStop(why, null, shouldClose);
  }
  private void safetyStop(String why, Promise completion, boolean shouldClose) {
    if (stopFrame == null || gatt == null) {
      reject(completion, "No armed connection; stop delivery unavailable");
      return;
    }
    startSafetyBatch(why, safetyService, stopFrame, completion, shouldClose, false);
  }
  private void startSafetyBatch(String why, UUID service, byte[] frame, Promise completion, boolean shouldClose, boolean release) {
    if (emergency) {
      if (!release && pendingStop == null) {
        pendingStop = new PendingStop(why, service, frame, completion);
        if (resumeAfterSafety) safetyEscalation = why;
        closeAfterSafety|=shouldClose;
        return;
      }
      reject(completion, "A native priority write is already in progress");
      return;
    }
    final long batch = safetyBatches.begin();
    emergency = true;
    resumeAfterSafety = release;
    safetyEscalation = null;
    safetyBatch.waitingForRadio();
    safetyPromise = completion;
    closeAfterSafety = shouldClose;
    safetyReason = why;
    if (!release) {
      manualInputAllowed = false;
      if (pulseDeadline.active()) {
        String id = pulseOperation.id;
        pulseEvent(id);
      }
      finishPulse("Pulse canceled by STOP");
      pulseBatchOwner = null;
      clearSourceLeases();
      lease.disarm();
      manualLease.disarm();
      radio.removeCallbacks(manualWatchdog);
      radio.removeCallbacks(watchdog);
    }
    final BluetoothGatt source = gatt;
    while (!queue.isEmpty()) reject(queue.remove().promise, why);
    if (!release) state("safety-stop", why, completion != null);
    Runnable attempt = new Runnable() {
      int tries = 0;
      public void run() {
        if (gatt != source || !safetyBatches.current(batch)) return;
        if (active != null && tries++<10) {
          radio.postDelayed(this, 20);
          return;
        }
        if (active != null) {
          close(why + "; radio busy, stop not transmitted");
          return;
        }
        safetyBatch.begin((frame.length + 19)/20);
        for (int offset = 0;offset<frame.length;offset += 20) {
          Op op = new Op("write", service, API, Arrays.copyOfRange(frame, offset, Math.min(offset + 20, frame.length)), true, null);
          op.safety = true;
          queue.addLast(op);
        }
        next();
      }
    };
    radio.postDelayed(() -> {
      if (gatt == source && safetyBatches.current(batch) && safetyBatch.pending()) close(why + "; stop transmission timed out");
    }, 800);
    attempt.run();
  }
  private void priorityWrite(String service, String uuid, String base64, Promise p, boolean release) {
    radio.post(() -> {
      try {
        if (!API.equals(UUID.fromString(uuid))) throw new IllegalArgumentException("Priority write is API-only");
        byte[] frames = Base64.decode(base64, Base64.DEFAULT);
        if (frames.length == 0 || frames.length>100) throw new IllegalArgumentException("Invalid priority frame length");
        UUID actualService = UUID.fromString(service);
        if (find(actualService, API) == null) throw new IllegalStateException("No matching API service; stop delivery unavailable");
        if (release && (!foreground || stopFrame == null)) throw new IllegalStateException("No foreground armed connection for drive release");
        startSafetyBatch(release ? "Drive released" : "User STOP requested", actualService, frames, p, false, release);
      } catch (Exception error) {
        reject(p, error.toString());
      }
    });
  }
  @ReactMethod public void emergencyWrite(String service, String uuid, String base64, Promise p) {
    priorityWrite(service, uuid, base64, p, false);
  }
  @ReactMethod public void priorityWrite(String service, String uuid, String base64, Promise p) {
    priorityWrite(service, uuid, base64, p, true);
  }
  @ReactMethod public void disconnect(Promise p) {
    radio.post(() -> {
      if (gatt != null && (stopFrame != null || emergency)) {
        final long wait = resumeAfterSafety ? 1700:850;
        requestSafetyStop("Explicit disconnect", true);
        final BluetoothGatt source = gatt;
        radio.postDelayed(() -> {
          if (gatt == source) close("Explicit disconnect");
          p.resolve(null);
        }, wait);
      } else {
        close("Explicit disconnect");
        p.resolve(null);
      }
    });
  }
  private void close(String reason) {
    if (pulseDeadline.active() && pulseOperation != null) pulseEvent(pulseOperation.id);
    finishPulse(reason);
    pulseBatchOwner = null;
    clearSourceLeases();
    connections.invalidate();
    safetyBatches.invalidate();
    if (pendingStop != null) {
      reject(pendingStop.promise, reason);
      pendingStop = null;
    }
    resumeAfterSafety = false;
    safetyEscalation = null;
    reject(safetyPromise, reason);
    safetyPromise = null;
    safetyBatch.reset();
    safetyService = null;
    closing = true;
    stopFrame = null;
    lease.disarm();
    manualLease.disarm();
    radio.removeCallbacks(manualWatchdog);
    radio.removeCallbacks(watchdog);
    reject(connectPromise, reason);
    connectPromise = null;
    if (active != null) {
      reject(active.promise, reason);
      active = null;
    }
    while (!queue.isEmpty()) reject(queue.remove().promise, reason);
    BluetoothGatt old = gatt;
    gatt = null;
    if (old != null) {
      try {
        old.disconnect();
        old.close();
      } catch (SecurityException ignored) {}
    }
    state("disconnected", reason);
  }
  private void controlPriority(boolean activeControl) {
    if (gatt == null) return;
    try {
      if (!GattConnection.setControlForeground(gatt, activeControl)) android.util.Log.w("R2Ble", "Connection priority request refused; safety deadlines unchanged");
    } catch (SecurityException error) {
      android.util.Log.w("R2Ble", "Connection priority unavailable", error);
    }
  }
  @Override public void onHostResume() {
    radio.post(() -> {
      foreground = true;
      controlPriority(true);
      if (stopFrame != null && !emergency) {
        lease.arm(SystemClock.elapsedRealtime(), 500);
        radio.removeCallbacks(watchdog);
        radio.postDelayed(watchdog, 50);
      }
      state("foreground", "App resumed");
    });
  }
  @Override public void onHostPause() {
    radio.post(() -> {
      foreground = false;
      state("background", "App entered background");
      stopScanning();
      requestSafetyStop("App entered background");
    });
  }
  @Override public void onHostDestroy() {
    radio.post(() -> {
      foreground = false;
      stopScanning();
      requestSafetyStop("Host destroyed", true);
    });
  }
  @Override public void invalidate() {
    preferenceWrites.shutdown();
    getReactApplicationContext().removeLifecycleEventListener(this);
    if (documentPromise != null) {
      documentPromise.reject("LOCAL_CONTENT", "Bridge invalidated");
      documentPromise = null;
    }
    if (exportPromise != null) {
      exportPromise.reject("LOCAL_CONTENT", "Bridge invalidated");
      exportPromise = null;
      exportText = null;
    }
    radio.post(() -> {
      foreground = false;
      stopScanning();
      requestSafetyStop("Bridge invalidated", true);
      radio.postDelayed(() -> thread.quitSafely(), 1800);
    });
    super.invalidate();
  }
}
