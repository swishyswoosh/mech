package local.r2controller;
import android.app.Activity;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.input.InputManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.ViewTreeObserver;
import android.widget.TextView;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.core.DeviceEventManagerModule;
/** Explicit foreground-only input source. This module never issues droid commands. */
public final class R2ExternalInputModule extends ReactContextBaseJavaModule implements LifecycleEventListener, SensorEventListener, InputManager.InputDeviceListener {
  private static volatile R2ExternalInputModule current;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final SensorManager sensors;
  private final InputManager inputs;
  private final ExternalInputState gamepad = new ExternalInputState();
  private final CockpitGamepadState cockpitPad = new CockpitGamepadState();
  private String mode;
  private boolean foreground;
  private long startedAt, lastSensorAt, lastEmission, startedSensorNanos;
  private View focusRoot;
  private final ViewTreeObserver.OnGlobalFocusChangeListener focusListener = (oldFocus, newFocus) -> {
    if (mode != null && textEditor(newFocus)) {
      gamepad.clearKnowledge();
      stopInternal("Text editing took focus; external input revoked");
    }
  };
  private int rotation;
  private double beta, gamma;
  private boolean orientationValid;
  public R2ExternalInputModule(ReactApplicationContext context) {
    super(context);
    sensors = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
    inputs = (InputManager) context.getSystemService(Context.INPUT_SERVICE);
    foreground = context.getLifecycleState() == LifecycleState.RESUMED;
    context.addLifecycleEventListener(this);
    if (inputs != null) inputs.registerInputDeviceListener(this, main);
    current = this;
  }
  @Override public String getName() {
    return "R2ExternalInput";
  }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(double count) {}
  private boolean focused() {
    Activity activity = getReactApplicationContext().getCurrentActivity();
    return foreground && activity != null && activity.hasWindowFocus();
  }
  private int displayRotation() {
    Activity activity = getReactApplicationContext().getCurrentActivity();
    android.view.Display display = activity == null ? null:activity.getWindow().getDecorView().getDisplay();
    return display == null ? - 1:display.getRotation();
  }
  private static boolean textEditor(View view) {
    return view instanceof TextView && view.onCheckIsTextEditor();
  }
  private void watchFocus() {
    Activity activity = getReactApplicationContext().getCurrentActivity();
    if (activity != null) {
      focusRoot = activity.getWindow().getDecorView();
      focusRoot.getViewTreeObserver().addOnGlobalFocusChangeListener(focusListener);
    }
  }
  private static boolean gamepadDevice(InputDevice device) {
    if (device == null) return false;
    int source = device.getSources();
    return(source&InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (source&InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
  }
  @ReactMethod public void startCockpit(Promise promise) {
    start("cockpit", promise);
  }
  @ReactMethod public void start(String requested, Promise promise) {
    main.post(() -> {
      stopInternal(null);
      if (!"gamepad".equals(requested) && !"tilt".equals(requested) && !"cockpit".equals(requested)) {
        promise.reject("EXTERNAL_INPUT", "Choose gamepad or tilt");
        return;
      }
      if (!focused()) {
        promise.reject("EXTERNAL_INPUT", "External input requires the foreground focused activity");
        return;
      }
      if (textEditor(getReactApplicationContext().getCurrentActivity().getCurrentFocus())) {
        promise.reject("EXTERNAL_INPUT", "Finish text editing, tap and release the drive thumbpad to move focus out of the text field, then activate external input");
        return;
      }
      startedAt = SystemClock.uptimeMillis();
      startedSensorNanos = SystemClock.elapsedRealtimeNanos();
      lastEmission = 0;
      lastSensorAt = 0;
      orientationValid = false;
      if ("gamepad".equals(requested) || "cockpit".equals(requested)) {
        int selected = - 1;
        for (int id:InputDevice.getDeviceIds()) if (gamepadDevice(InputDevice.getDevice(id))) {
          selected = id;
          break;
        }
        if (selected<0) {
          promise.reject("EXTERNAL_INPUT", "No connected Android gamepad is available");
          return;
        }
        gamepad.start(selected);
        cockpitPad.start(selected);
        mode = requested;
        // Only an observed KEY_UP is a known release. Unknown/preheld LB is emitted
        // as held, so the shared model requires UP followed by a new DOWN.
        if ("gamepad".equals(mode)) emitGamepad();
      } else {
        Sensor sensor = sensors == null ? null:sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
        if (sensor == null && sensors != null) sensor = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (sensor == null) {
          promise.reject("EXTERNAL_INPUT", "Phone rotation sensor is unavailable");
          return;
        }
        rotation = displayRotation();
        mode = requested;
      // 20 Hz is below Android's high-rate permission threshold. No location/microphone permission.
        if (!sensors.registerListener(this, sensor, 50_000, 0, main)) {
          mode = null;
          promise.reject("EXTERNAL_INPUT", "Phone rotation sensor could not start");
          return;
        }
      }
      watchFocus();
      main.postDelayed(tick, 50);
      promise.resolve(null);
    });
  }
  @ReactMethod public void stop(Promise promise) {
    main.post(() -> {
      stopInternal(null);
      promise.resolve(null);
    });
  }
  private void emit(WritableMap sample) {
    sample.putDouble("at", System.currentTimeMillis());
    if (getReactApplicationContext().hasActiveReactInstance())
      getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("R2ExternalInputSample", sample);
    lastEmission = SystemClock.uptimeMillis();
  }
  private void emitGamepad() {
    WritableMap sample = Arguments.createMap();
    sample.putString("kind", "gamepad");
    sample.putInt("deviceId", gamepad.device());
    sample.putDouble("x", gamepad.x());
    sample.putDouble("y", gamepad.y());
    sample.putBoolean("deadman", gamepad.held());
    emit(sample);
  }
  private void emitCockpit(Integer button, Boolean pressed, boolean repeat) {
    if (!cockpitPad.hasSample()) return;
    WritableMap sample = Arguments.createMap();
    sample.putString("kind", "cockpitGamepad");
    sample.putInt("deviceId", cockpitPad.device());
    sample.putDouble("at", System.currentTimeMillis() - (SystemClock.uptimeMillis() - cockpitPad.at()));
    WritableArray axes = Arguments.createArray();
    for (float axis:cockpitPad.axes()) axes.pushDouble(axis);
    sample.putArray("axes", axes);
    WritableArray buttons = Arguments.createArray();
    for (boolean down:cockpitPad.buttons()) buttons.pushBoolean(down);
    sample.putArray("buttons", buttons);
    if (button != null) {
      WritableMap edge = Arguments.createMap();
      edge.putInt("button", button);
      edge.putBoolean("pressed", pressed);
      edge.putBoolean("repeat", repeat);
      sample.putMap("edge", edge);
    }
    if (getReactApplicationContext().hasActiveReactInstance())
      getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("R2ExternalInputSample", sample);
    lastEmission = SystemClock.uptimeMillis();
  }
  private void emitTilt() {
    WritableMap sample = Arguments.createMap();
    sample.putString("kind", "tilt");
    sample.putDouble("beta", beta);
    sample.putDouble("gamma", gamma);
    emit(sample);
  }
  private void stopInternal(String reason) {
    boolean wasActive = mode != null;
    String previous = mode;
    mode = null;
    if (focusRoot != null) {
      if (focusRoot.getViewTreeObserver().isAlive()) focusRoot.getViewTreeObserver().removeOnGlobalFocusChangeListener(focusListener);
      focusRoot = null;
    }
    main.removeCallbacks(tick);
    if (sensors != null) sensors.unregisterListener(this);
    gamepad.stop();
    cockpitPad.stop();
    orientationValid = false;
    lastSensorAt = 0;
    if (reason != null && wasActive) {
      WritableMap event = Arguments.createMap();
      event.putString("kind", "revoked");
      event.putString("source", previous);
      event.putString("reason", reason);
      emit(event);
    }
  }
  private final Runnable tick = new Runnable() {
    @Override public void run() {
      if (mode == null) return;
      if (!focused()) {
        gamepad.clearKnowledge();
        stopInternal("External input lost focus");
        return;
      }
      long now = SystemClock.uptimeMillis();
      if ("cockpit".equals(mode)) {
        if (!gamepadDevice(InputDevice.getDevice(cockpitPad.device()))) {
          stopInternal("Gamepad disconnected");
          return;
        }
        if ((!cockpitPad.hasSample() && now - startedAt>2000) || cockpitPad.stale(now)) {
          stopInternal("Gamepad hardware input stale; activate again");
          return;
        }
        if (cockpitPad.hasSample()) emitCockpit(null, null, false);
      } else if ("gamepad".equals(mode)) {
        if (!gamepadDevice(InputDevice.getDevice(gamepad.device()))) {
          gamepad.clearKnowledge();
          stopInternal("Gamepad disconnected");
          return;
        }
        if (gamepad.stale(now)) {
          gamepad.clearKnowledge();
          stopInternal("Gamepad hardware input stale; release LB and activate again");
          return;
        }
        emitGamepad();
      } else {
        if ((lastSensorAt == 0 && now - startedAt>2000) || (lastSensorAt != 0 && now - lastSensorAt>ExternalInputState.STALE_MS)) {
          stopInternal("Phone orientation input stale; activate again");
          return;
        }
        if (orientationValid) emitTilt();
      }
      if (mode != null) main.postDelayed(this, 50);
    }
  };
  public static boolean dispatchKey(KeyEvent event) {
    R2ExternalInputModule module = current;
    return module != null && module.key(event);
  }
  public static boolean dispatchMotion(MotionEvent event) {
    R2ExternalInputModule module = current;
    return module != null && module.motion(event);
  }
  public static void windowFocus(boolean focused) {
    R2ExternalInputModule module = current;
    if (module != null && !focused) {
      module.gamepad.clearKnowledge();
      module.stopInternal("External input lost window focus");
    }
  }
  private static int standardButton(int key) {
    switch (key) {
      case KeyEvent.KEYCODE_BUTTON_A:return 0;
      case KeyEvent.KEYCODE_BUTTON_B:return 1;
      case KeyEvent.KEYCODE_BUTTON_X:return 2;
      case KeyEvent.KEYCODE_BUTTON_Y:return 3;
      case KeyEvent.KEYCODE_BUTTON_L1:return 4;
      case KeyEvent.KEYCODE_BUTTON_R1:return 5;
      case KeyEvent.KEYCODE_BUTTON_L2:return 6;
      case KeyEvent.KEYCODE_BUTTON_R2:return 7;
      case KeyEvent.KEYCODE_BUTTON_SELECT:return 8;
      case KeyEvent.KEYCODE_BUTTON_START:return 9;
      case KeyEvent.KEYCODE_BUTTON_THUMBL:return 10;
      case KeyEvent.KEYCODE_BUTTON_THUMBR:return 11;
      case KeyEvent.KEYCODE_DPAD_UP:return 12;
      case KeyEvent.KEYCODE_DPAD_DOWN:return 13;
      case KeyEvent.KEYCODE_DPAD_LEFT:return 14;
      case KeyEvent.KEYCODE_DPAD_RIGHT:return 15;
      case KeyEvent.KEYCODE_BUTTON_MODE:return 16;
      default:return - 1;
    }
  }
  private boolean key(KeyEvent event) {
    if ("cockpit".equals(mode) && gamepadDevice(event.getDevice()) && focused() && event.getDeviceId() == cockpitPad.device()) {
      int button = standardButton(event.getKeyCode());
      if (button<0) return false;
      if (event.getAction() != KeyEvent.ACTION_DOWN && event.getAction() != KeyEvent.ACTION_UP) return true;
      if (event.getEventTime() < startedAt
          || !cockpitPad.button(event.getDeviceId(), button, event.getAction() == KeyEvent.ACTION_DOWN, event.getEventTime())
          || cockpitPad.stale(SystemClock.uptimeMillis())) {
        stopInternal("Delayed gamepad button event");
        return true;
      }
      emitCockpit(button, event.getAction() == KeyEvent.ACTION_DOWN, event.getRepeatCount()>0);
      return true;
    }
    if (event.getKeyCode() != KeyEvent.KEYCODE_BUTTON_L1 || !gamepadDevice(event.getDevice()) || !focused()) return false;
    if (event.getAction() != KeyEvent.ACTION_DOWN && event.getAction() != KeyEvent.ACTION_UP) return false;
    gamepad.observeButton(event.getDeviceId(), event.getAction() == KeyEvent.ACTION_DOWN, event.getEventTime());
    if (!"gamepad".equals(mode) || gamepad.device() != event.getDeviceId()) return false;
    if (gamepad.stale(SystemClock.uptimeMillis())) {
      gamepad.clearKnowledge();
      stopInternal("Delayed gamepad button event");
      return true;
    }
    emitGamepad();
    return true;
  }
  private boolean motion(MotionEvent event) {
    if ("cockpit".equals(mode) && focused() && gamepadDevice(event.getDevice())
        && event.getAction() == MotionEvent.ACTION_MOVE && event.getDeviceId() == cockpitPad.device()) {
      InputDevice device = event.getDevice();
      if (device.getMotionRange(MotionEvent.AXIS_X, event.getSource()) == null || device.getMotionRange(MotionEvent.AXIS_Y, event.getSource()) == null) {
        stopInternal("Gamepad left-stick axes unavailable");
        return true;
      }
      int rx = device.getMotionRange(MotionEvent.AXIS_Z, event.getSource()) != null ? MotionEvent.AXIS_Z:MotionEvent.AXIS_RX;
      int ry = device.getMotionRange(MotionEvent.AXIS_RZ, event.getSource()) != null ? MotionEvent.AXIS_RZ:MotionEvent.AXIS_RY;
      if (event.getEventTime() < startedAt
          || !cockpitPad.axes(event.getDeviceId(), event.getAxisValue(MotionEvent.AXIS_X),
              event.getAxisValue(MotionEvent.AXIS_Y), event.getAxisValue(rx), event.getAxisValue(ry), event.getEventTime())
          || cockpitPad.stale(SystemClock.uptimeMillis())) {
        stopInternal("Delayed gamepad axes");
        return true;
      }
      // Android controllers may deliver D-pad only through the hat axes.
      float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X), hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
      if (!cockpitPad.hat(event.getDeviceId(), hatX, hatY, event.getEventTime())) {
        stopInternal("Invalid gamepad hat axes");
        return true;
      }
      if (SystemClock.uptimeMillis() - lastEmission >= 50) emitCockpit(null, null, false);
      return true;
    }
    if (!"gamepad".equals(mode) || !focused() || !gamepadDevice(event.getDevice())
        || event.getAction() != MotionEvent.ACTION_MOVE || event.getDeviceId() != gamepad.device()) return false;
    InputDevice device = event.getDevice();
    InputDevice.MotionRange xRange = device.getMotionRange(MotionEvent.AXIS_X, event.getSource()), yRange = device.getMotionRange(MotionEvent.AXIS_Y, event.getSource());
    if (xRange == null || yRange == null) {
      stopInternal("Gamepad left-stick axes are unavailable");
      return true;
    }
    gamepad.move(event.getDeviceId(), event.getAxisValue(MotionEvent.AXIS_X), event.getAxisValue(MotionEvent.AXIS_Y),
        xRange.getFlat(), yRange.getFlat(), Math.max(Math.abs(xRange.getMin()), Math.abs(xRange.getMax())),
        Math.max(Math.abs(yRange.getMin()), Math.abs(yRange.getMax())), event.getEventTime());
    long now = SystemClock.uptimeMillis();
    if (gamepad.stale(now)) {
      gamepad.clearKnowledge();
      stopInternal("Delayed gamepad axis event");
      return true;
    }
    if (now - lastEmission >= 50) emitGamepad();
    return true;
  }
  @Override public void onSensorChanged(SensorEvent event) {
    if (!"tilt".equals(mode)) return;
    if (!focused()) {
      stopInternal("Phone orientation lost focus");
      return;
    }
    if (displayRotation() != rotation) {
      stopInternal("Screen orientation changed; capture a new neutral position");
      return;
    }
    if (event.timestamp<startedSensorNanos) return;
    if (event.values.length<3) {
      stopInternal("Phone orientation sample incomplete");
      return;
    }
    long sampleAge = SystemClock.elapsedRealtimeNanos() - event.timestamp;
    if (sampleAge<0 || sampleAge>250_000_000L) {
      stopInternal("Phone orientation sample arrived stale");
      return;
    }
    for (float value:event.values) if (!Float.isFinite(value)) {
      stopInternal("Phone orientation sample invalid");
      return;
    }
    float[] matrix = new float[9], adjusted = new float[9], angles = new float[3];
    SensorManager.getRotationMatrixFromVector(matrix, event.values);
    int axisX = SensorManager.AXIS_X, axisY = SensorManager.AXIS_Y;
    if (rotation == Surface.ROTATION_90) {
      axisX = SensorManager.AXIS_Y;
      axisY = SensorManager.AXIS_MINUS_X;
    } else if (rotation == Surface.ROTATION_180) {
      axisX = SensorManager.AXIS_MINUS_X;
      axisY = SensorManager.AXIS_MINUS_Y;
    } else if (rotation == Surface.ROTATION_270) {
      axisX = SensorManager.AXIS_MINUS_Y;
      axisY = SensorManager.AXIS_X;
    }
    if (!SensorManager.remapCoordinateSystem(matrix, axisX, axisY, adjusted)) {
      stopInternal("Phone orientation remapping failed");
      return;
    }
    SensorManager.getOrientation(adjusted, angles);
    beta = Math.toDegrees(angles[1]);
    gamma = Math.toDegrees(angles[2]);
    if (!Double.isFinite(beta) || !Double.isFinite(gamma)) {
      stopInternal("Phone orientation calculation invalid");
      return;
    }
    lastSensorAt = SystemClock.uptimeMillis();
    orientationValid = true;
    if (lastSensorAt - lastEmission >= 50) emitTilt();
  }
  @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {
    if ("tilt".equals(mode) && accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) stopInternal("Phone orientation sensor is unreliable");
  }
  @Override public void onInputDeviceAdded(int id) {}
  @Override public void onInputDeviceChanged(int id) {
    if ("cockpit".equals(mode) && id == cockpitPad.device()) {
      stopInternal("Gamepad input device changed; activate again");
      return;
    }
    if (("gamepad".equals(mode) || "cockpit".equals(mode)) && id == gamepad.device() && !gamepadDevice(InputDevice.getDevice(id))) {
      gamepad.clearKnowledge();
      stopInternal("Gamepad input source changed");
    }
  }
  @Override public void onInputDeviceRemoved(int id) {
    if (id == gamepad.device()) {
      gamepad.clearKnowledge();
      stopInternal("Gamepad disconnected");
    } else gamepad.forget(id);
  }
  @Override public void onHostResume() {
    foreground = true;
  }
  @Override public void onHostPause() {
    foreground = false;
    main.post(() -> {
      gamepad.clearKnowledge();
      stopInternal("App entered background");
    });
  }
  @Override public void onHostDestroy() {
    foreground = false;
    main.post(() -> {
      gamepad.clearKnowledge();
      stopInternal("Activity destroyed");
    });
  }
  @Override public void invalidate() {
    getReactApplicationContext().removeLifecycleEventListener(this);
    if (inputs != null) inputs.unregisterInputDeviceListener(this);
    main.post(() -> {
      gamepad.clearKnowledge();
      stopInternal("External input bridge closed");
      if (current == this) current = null;
    });
    super.invalidate();
  }
}
