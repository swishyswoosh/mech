package local.r2controller;
import android.graphics.*;
import android.content.res.ColorStateList;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import com.facebook.react.bridge.*;
import com.facebook.react.uimanager.*;
import com.facebook.react.uimanager.annotations.ReactProp;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.uimanager.events.EventDispatcher;
import java.util.*;
/** Platform SeekBars and a split-touch native container avoid the single JS responder lease. */
public final class R2InputViews {
  private static final class ControlEvent extends Event<ControlEvent> {
    private final String name;
    private final WritableMap data;
    ControlEvent(View view, String name, WritableMap data) {
      super(UIManagerHelper.getSurfaceId(view), view.getId());
      this.name = name;
      this.data = data;
    }
    @Override public String getEventName() {
      return name;
    }
    @Override protected WritableMap getEventData() {
      return data;
    }
    // Start, move and release share an event name; dropping any would break ownership.
    @Override public boolean canCoalesce() {
      return false;
    }
  }
  private static void emit(View view, String name, WritableMap event) {
    EventDispatcher dispatcher = UIManagerHelper.getEventDispatcher((ReactContext) view.getContext());
    if (dispatcher != null) dispatcher.dispatchEvent(new ControlEvent(view, name, event));
  }
  private static Map<String, Object> event(String name) {
    return Collections.singletonMap(name, Collections.singletonMap("registrationName", name.equals("topValueChange") ? "onValueChange":"onControlChange"));
  }
  public static final class SliderView extends androidx.appcompat.widget.AppCompatSeekBar {
    double minimum = 0, maximum = 100, step = 1, value = 0;
    SliderScale scale = new SliderScale(0, 100, 1);
    SliderView(ThemedReactContext context) {
      super(context);
      setMinimumHeight((int)(48*getResources().getDisplayMetrics().density));
      setOnSeekBarChangeListener(new OnSeekBarChangeListener() {
        public void onProgressChanged(SeekBar bar, int progress, boolean user) {
          value = scale.value(progress);
          if (user) {
            WritableMap map = Arguments.createMap();
            map.putDouble("value", value);
            emit(SliderView.this, "topValueChange", map);
          }
        }
        public void onStartTrackingTouch(SeekBar bar) {
          getParent().requestDisallowInterceptTouchEvent(true);
        }
        public void onStopTrackingTouch(SeekBar bar) {
          getParent().requestDisallowInterceptTouchEvent(false);
        }
      });
    }
    void configure() {
      double desired = value;
      scale = new SliderScale(minimum, maximum, step);
      setMax(scale.maximumProgress());
      setProgress(scale.progress(desired));
      value = scale.value(getProgress());
    }
    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
      super.onInitializeAccessibilityNodeInfo(info);
      info.setRangeInfo(ModernDependencyApis.rangeInfo((float) minimum, (float) maximum, (float) value));
    }
  }
  public static final class SliderManager extends SimpleViewManager<SliderView> {
    public String getName() {
      return "R2Slider";
    }
    protected SliderView createViewInstance(ThemedReactContext c) {
      return new SliderView(c);
    }
    @ReactProp(name = "minimumValue", defaultDouble = 0) public void minimum(SliderView v, double n) {
      v.minimum = n;
    }
    @ReactProp(name = "maximumValue", defaultDouble = 100) public void maximum(SliderView v, double n) {
      v.maximum = n;
    }
    @ReactProp(name = "step", defaultDouble = 1) public void step(SliderView v, double n) {
      v.step = n;
    }
    @ReactProp(name = "value", defaultDouble = 0) public void value(SliderView v, double n) {
      v.value = Double.isFinite(n) ? n:0;
    }
    @ReactProp(name = "enabled", defaultBoolean = true) public void enabled(SliderView v, boolean b) {
      v.setEnabled(b);
    }
    @ReactProp(name = "accentColor", customType = "Color") public void accent(SliderView v, Integer color) {
      if (color != null) {
        v.setThumbTintList(ColorStateList.valueOf(color));
        v.setProgressTintList(ColorStateList.valueOf(color));
      }
    }
    @ReactProp(name = "mutedColor", customType = "Color") public void muted(SliderView v, Integer color) {
      if (color != null) v.setProgressBackgroundTintList(ColorStateList.valueOf(color));
    }
    @ReactProp(name = "surfaceColor", customType = "Color") public void surface(SliderView v, Integer color) {}
    @ReactProp(name = "textColor", customType = "Color") public void text(SliderView v, Integer color) {}
    @Override protected void onAfterUpdateTransaction(SliderView v) {
      super.onAfterUpdateTransaction(v);
      v.configure();
    }
    @Override public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
      return event("topValueChange");
    }
  }
  public static final class DriveView extends ViewGroup {
    final ViewTreeObserver.OnGlobalFocusChangeListener focusListener = (oldFocus, newFocus) -> {
      if (newFocus instanceof android.widget.EditText || !inside(newFocus)) releasePad();
    };
    boolean inside(View view) {
      while (view != null) {
        if (view == this) return true;
        android.view.ViewParent parent = view.getParent();
        view = parent instanceof View ? (View) parent:null;
      }
      return false;
    }
    int accentColor = Color.rgb(255, 98, 98), mutedColor = Color.rgb(102, 102, 114), surfaceColor = Color.rgb(21, 21, 24);
    int stickHighlightColor = Color.rgb(255, 181, 181), stickShadowColor = Color.rgb(155, 30, 43), stickRingColor = Color.rgb(255, 153, 153);
    final DrivePointerOwners owners = new DrivePointerOwners();
    final Pad pad;
    final OwnedSpeed speed;
    final TextView label;
    boolean driveEnabled = false, cockpit = false;
    double speedValue = 25;
    DriveView(ThemedReactContext context) {
      super(context);
      setMotionEventSplittingEnabled(true);
      pad = new Pad(context);
      speed = new OwnedSpeed(context);
      label = new TextView(context);
      label.setTextColor(Color.rgb(24, 34, 53));
      label.setTextSize(16);
      label.setGravity(Gravity.CENTER);
      speed.setMax(100);
      speed.setProgress(25);
      speed.setContentDescription("Speed cap percent");
      speed.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
        public void onProgressChanged(SeekBar bar, int progress, boolean user) {
          speedValue = progress;
          label.setText("Speed cap\n" + progress + "%");
          if (user) {
            WritableMap map = Arguments.createMap();
            map.putString("kind", "speed");
            map.putDouble("value", progress);
            emit(DriveView.this, "topControlChange", map);
          }
        }
        public void onStartTrackingTouch(SeekBar bar) {}
        public void onStopTrackingTouch(SeekBar bar) {}
      });
      addView(pad);
      addView(label);
      addView(speed);
      label.setText("Speed cap\n25%");
    }
    void demand(String kind, float x, float y) {
      if (android.util.Log.isLoggable("R2Latency", android.util.Log.DEBUG)) android.util.Log.d("R2Latency", "touch " + kind + " x=" + x + " y=" + y);
      WritableMap map = Arguments.createMap();
      map.putString("kind", kind);
      map.putDouble("x", x);
      map.putDouble("y", y);
      emit(this, "topControlChange", map);
    }
    void releasePad() {
      int pointer = owners.owner(DrivePointerOwners.PAD);
      if (pointer != - 1) {
        owners.end(DrivePointerOwners.PAD, pointer);
        pad.relative.clear();
        pad.x = pad.y = 0;
        pad.invalidate();
        demand("release", 0, 0);
      }
    }
    void revoke() {
      releasePad();
      owners.clear();
    }
    @Override public void onWindowFocusChanged(boolean focus) {
      super.onWindowFocusChanged(focus);
      if (!focus) revoke();
    }
    @Override protected void onAttachedToWindow() {
      super.onAttachedToWindow();
      getViewTreeObserver().addOnGlobalFocusChangeListener(focusListener);
    }
    @Override protected void onDetachedFromWindow() {
      getViewTreeObserver().removeOnGlobalFocusChangeListener(focusListener);
      revoke();
      super.onDetachedFromWindow();
    }
    int band() {
      return (int)(64*getResources().getDisplayMetrics().density);
    }
    @Override protected void onMeasure(int ws, int hs) {
      int w = MeasureSpec.getSize(ws), h = MeasureSpec.getSize(hs), diameter = cockpit ? w:Math.min((int)(w*.60), h), right = Math.max(0, w - diameter);
      setMeasuredDimension(w, h);
      pad.measure(MeasureSpec.makeMeasureSpec(diameter, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(cockpit ? h:diameter, MeasureSpec.EXACTLY));
      label.measure(MeasureSpec.makeMeasureSpec(right, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(Math.min(h/2, band()), MeasureSpec.EXACTLY));
      speed.measure(MeasureSpec.makeMeasureSpec(right, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(Math.min(h/2, band()), MeasureSpec.EXACTLY));
    }
    @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
      int width = r - l, height = b - t;
      int diameter = cockpit ? width:Math.min((int)(width*.60), height);
      pad.layout(0, cockpit ? 0:(height - diameter)/2, diameter, cockpit ? height:(height + diameter)/2);
      label.layout(diameter, Math.max(0, height/2 - band()), width, height/2);
      speed.layout(diameter, height/2, width, Math.min(height, height/2 + band()));
    }
    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
      return false;
    }
    final class Pad extends View {
      final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
      final RelativeThumbpad relative = new RelativeThumbpad();
      float x = 0, y = 0;
      Pad(ThemedReactContext c) {
        super(c);
        setFocusableInTouchMode(true);
        setContentDescription("Drive thumbpad. Hold to drive, release to stop. Accessible directional pulse buttons are below.");
      }
      void update(MotionEvent event, int index, String kind) {
        float radius = ThumbpadGeometry.radius(getWidth(), getHeight());
        float[] point = kind.equals("start")
            ? relative.begin(event.getPointerId(index), event.getX(index), event.getY(index))
            : relative.move(event.getPointerId(index), event.getX(index), event.getY(index), radius);
        if (point == null) return;
        x = point[0];
        y = point[1];
        invalidate();
        demand(kind, x, y);
      }
      @Override public boolean onTouchEvent(MotionEvent e) {
        int action = e.getActionMasked(), index = e.getActionIndex(), pointer = e.getPointerId(index);
        if (action == MotionEvent.ACTION_DOWN) {
          if (!driveEnabled || !ThumbpadGeometry.contains(getWidth(), getHeight(), e.getX(index), e.getY(index))
              || !owners.begin(DrivePointerOwners.PAD, pointer)) return false;
          requestFocus();
          getParent().requestDisallowInterceptTouchEvent(true);
          update(e, index, "start");
          return true;
        }
        if (action == MotionEvent.ACTION_MOVE) {
          index = e.findPointerIndex(owners.owner(DrivePointerOwners.PAD));
          if (index >= 0) update(e, index, "move");
          else releasePad();
          return true;
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
          if (owners.owns(DrivePointerOwners.PAD, pointer)) releasePad();
          return true;
        }
        if (action == MotionEvent.ACTION_CANCEL) {
          releasePad();
          return true;
        }
        return true;
      }
      @Override protected void onDraw(Canvas c) {
        super.onDraw(c);
        boolean held = owners.owner(DrivePointerOwners.PAD) != - 1;
        float cx = getWidth()/2f, cy = getHeight()/2f, r = ThumbpadGeometry.radius(getWidth(), getHeight());
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(surfaceColor);
        c.drawRect(0, 0, getWidth(), getHeight(), paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2);
        paint.setColor(driveEnabled ? accentColor:mutedColor);
        paint.setAlpha(held ? (int)(140 + 115*Math.min(1, Math.hypot(x, y))):110);
        c.drawCircle(cx, cy, r, paint);
        paint.setAlpha(90);
        c.drawCircle(cx, cy, r*.5f, paint);
        c.drawLine(cx - r - 7, cy, cx - r + 7, cy, paint);
        c.drawLine(cx + r - 7, cy, cx + r + 7, cy, paint);
        c.drawLine(cx, cy - r - 7, cx, cy - r + 7, paint);
        c.drawLine(cx, cy + r - 7, cx, cy + r + 7, paint);
        // The knob uses the shared web control's 176-unit schematic: halo, shaded
        // disc, highlighted rim and white inner ring. Only this knob moves.
        float kx = cx + x*r, ky = cy - y*r, unit = r/83f, knob = 26*unit;
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(accentColor);
        paint.setAlpha(held ? 48:20);
        c.drawCircle(kx, ky, 33*unit, paint);
        paint.setAlpha(driveEnabled ? 255:128);
        paint.setShader(new RadialGradient(kx - knob*.24f, ky - knob*.36f, knob*1.4f, new int[] {
          stickHighlightColor, accentColor, stickShadowColor
        }, new float[] {
          0, .52f, 1
        }, Shader.TileMode.CLAMP));
        c.drawCircle(kx, ky, knob, paint);
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1, unit));
        paint.setColor(stickRingColor);
        paint.setAlpha(driveEnabled ? 153:77);
        c.drawCircle(kx, ky, knob, paint);
        paint.setColor(Color.WHITE);
        paint.setAlpha(driveEnabled ? 115:58);
        c.drawCircle(kx, ky, 11*unit, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(driveEnabled ? accentColor:mutedColor);
        paint.setAlpha(held ? 255:100);
        if (!held) {
          paint.setTextAlign(Paint.Align.CENTER);
          paint.setTextSize(android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 12, getResources().getDisplayMetrics()));
          c.drawText(driveEnabled ? "HOLD TO DRIVE":"DRIVE UNAVAILABLE", cx, cy + r + 22, paint);
        }
        paint.setAlpha(255);
      }
    }
    final class OwnedSpeed extends androidx.appcompat.widget.AppCompatSeekBar {
      OwnedSpeed(ThemedReactContext c) {
        super(c);
      }
      @Override public boolean onTouchEvent(MotionEvent e) {
        int action = e.getActionMasked(), index = e.getActionIndex(), pointer = e.getPointerId(index);
        if (action == MotionEvent.ACTION_DOWN) {
          if (!owners.begin(DrivePointerOwners.SPEED, pointer)) return false;
          getParent().requestDisallowInterceptTouchEvent(true);
        } else if (action == MotionEvent.ACTION_CANCEL) {
          owners.end(DrivePointerOwners.SPEED, owners.owner(DrivePointerOwners.SPEED));
          return super.onTouchEvent(e);
        } else if (action == MotionEvent.ACTION_POINTER_DOWN) return true;
        int owner = owners.owner(DrivePointerOwners.SPEED), ownerIndex = e.findPointerIndex(owner);
        if (ownerIndex<0) return true;
        if ((action == MotionEvent.ACTION_POINTER_UP || action == MotionEvent.ACTION_UP) && pointer != owner) return true;
        int forwarded = action == MotionEvent.ACTION_POINTER_UP ? MotionEvent.ACTION_UP:action;
        MotionEvent single = MotionEvent.obtain(e.getDownTime(), e.getEventTime(), forwarded, e.getX(ownerIndex), e.getY(ownerIndex), e.getMetaState());
        boolean handled = super.onTouchEvent(single);
        single.recycle();
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) owners.end(DrivePointerOwners.SPEED, owner);
        return handled;
      }
    }
  }
  public static final class DriveManager extends SimpleViewManager<DriveView> {
    public String getName() {
      return "R2DriveControls";
    }
    protected DriveView createViewInstance(ThemedReactContext c) {
      return new DriveView(c);
    }
    @ReactProp(name = "accentColor", customType = "Color") public void accent(DriveView v, Integer color) {
      if (color != null) {
        v.accentColor = color;
        v.speed.setThumbTintList(ColorStateList.valueOf(color));
        v.speed.setProgressTintList(ColorStateList.valueOf(color));
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "mutedColor", customType = "Color") public void muted(DriveView v, Integer color) {
      if (color != null) {
        v.mutedColor = color;
        v.speed.setProgressBackgroundTintList(ColorStateList.valueOf(color));
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "surfaceColor", customType = "Color") public void surface(DriveView v, Integer color) {
      if (color != null) {
        v.surfaceColor = color;
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "textColor", customType = "Color") public void text(DriveView v, Integer color) {
      if (color != null) v.label.setTextColor(color);
    }
    @ReactProp(name = "stickHighlightColor", customType = "Color") public void stickHighlight(DriveView v, Integer color) {
      if (color != null) {
        v.stickHighlightColor = color;
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "stickShadowColor", customType = "Color") public void stickShadow(DriveView v, Integer color) {
      if (color != null) {
        v.stickShadowColor = color;
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "stickRingColor", customType = "Color") public void stickRing(DriveView v, Integer color) {
      if (color != null) {
        v.stickRingColor = color;
        v.pad.invalidate();
      }
    }
    @ReactProp(name = "driveEnabled", defaultBoolean = false) public void enabled(DriveView v, boolean enabled) {
      v.driveEnabled = enabled;
      if (!enabled) v.releasePad();
      v.pad.invalidate();
    }
    @ReactProp(name = "cockpit", defaultBoolean = false) public void cockpit(DriveView v, boolean enabled) {
      v.cockpit = enabled;
      v.speed.setVisibility(enabled ? View.GONE:View.VISIBLE);
      v.label.setVisibility(enabled ? View.GONE:View.VISIBLE);
      v.requestLayout();
    }
    @ReactProp(name = "speedPercent", defaultDouble = 25) public void speed(DriveView v, double speed) {
      v.speed.setProgress((int) Math.round(Math.max(0, Math.min(100, speed))));
    }
    @Override public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
      return event("topControlChange");
    }
  }
}
