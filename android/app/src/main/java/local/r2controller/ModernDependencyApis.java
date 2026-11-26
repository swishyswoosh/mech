package local.r2controller;

import android.content.Context;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.facebook.react.uimanager.DisplayMetricsHolder;

/** Version-gated replacements for deprecated dependency calls. */
public final class ModernDependencyApis {
 private ModernDependencyApis() {}
 public static void initDisplayMetrics(Context context) {
  DisplayMetrics metrics = new DisplayMetrics();
  metrics.setTo(context.getResources().getDisplayMetrics());
  if (Build.VERSION.SDK_INT >= 30) {
   WindowManager windows = context.getSystemService(WindowManager.class);
   if (windows != null) {
    try {
     Rect bounds = windows.getMaximumWindowMetrics().getBounds();
     metrics.widthPixels = bounds.width(); metrics.heightPixels = bounds.height();
    } catch (UnsupportedOperationException | IllegalArgumentException unavailable) {
     // Non-visual contexts retain the resource metrics.
    }
   }
  } else {
   legacyDisplayMetrics(context, metrics);
  }
  DisplayMetricsHolder.setScreenDisplayMetrics(metrics);
 }
 // API 26–29: WindowMetrics is available only from API 30. Preserve full-screen
 // dimensions on legacy devices, including navigation-bar space.
 @SuppressWarnings("deprecation")
 private static void legacyDisplayMetrics(Context context, DisplayMetrics metrics) {
  DisplayManager manager = context.getSystemService(DisplayManager.class);
  Display display = manager == null ? null : manager.getDisplay(Display.DEFAULT_DISPLAY);
  if (display != null) {
   DisplayMetrics physical = new DisplayMetrics();
   display.getRealMetrics(physical);
   // Keep resource fontScale/density; only the full display dimensions differ.
   metrics.widthPixels=physical.widthPixels; metrics.heightPixels=physical.heightPixels;
  }
 }
 public static void setStatusBarVisibility(Window window, boolean hidden) {
  if (!window.getDecorView().isAttachedToWindow()) return;
  WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
  controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  if (hidden) controller.hide(WindowInsetsCompat.Type.statusBars());
  else controller.show(WindowInsetsCompat.Type.statusBars());
 }
 static AccessibilityNodeInfo.RangeInfo rangeInfo(float min, float max, float value) {
  if (Build.VERSION.SDK_INT >= 30) return new AccessibilityNodeInfo.RangeInfo(AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT,min,max,value);
  return legacyRangeInfo(min,max,value);
 }
 // API 26–29: the public constructor was introduced in API 30.
 @SuppressWarnings("deprecation")
 private static AccessibilityNodeInfo.RangeInfo legacyRangeInfo(float min,float max,float value) {
  return AccessibilityNodeInfo.RangeInfo.obtain(AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT,min,max,value);
 }
 public static void setColorFilter(android.graphics.drawable.Drawable drawable,int color,android.graphics.PorterDuff.Mode mode) {
  drawable.setColorFilter(new android.graphics.PorterDuffColorFilter(color,mode));
 }
 public static void setStatusBarStyle(Window window,String style) {
  new WindowInsetsControllerCompat(window,window.getDecorView()).setAppearanceLightStatusBars("dark-content".equals(style));
 }
 public static void enableEdgeToEdge(Window window) {
  if (Build.VERSION.SDK_INT < 35) legacyEdgeToEdge(window);
  // Target 36 enforces edge-to-edge on API 35+. Insets are handled by the host.
  WindowInsetsControllerCompat controller=new WindowInsetsControllerCompat(window,window.getDecorView());
  boolean light=(window.getContext().getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)!=android.content.res.Configuration.UI_MODE_NIGHT_YES;
  controller.setAppearanceLightNavigationBars(light);
 }
 public static void disableEdgeToEdge(Window window) {
  if (Build.VERSION.SDK_INT < 35) androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window,true);
 }
 // API 26–34: transparent system-bar colors are required before enforced
 // edge-to-edge. API 35+ ignores these deprecated setters; it never calls here.
 @SuppressWarnings("deprecation")
 private static void legacyEdgeToEdge(Window window) {
  androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window,false);
  window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
  window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
  if (Build.VERSION.SDK_INT>=29) {
   window.setStatusBarContrastEnforced(false);
   android.content.res.TypedArray attrs=window.getContext().obtainStyledAttributes(new int[]{android.R.attr.enforceNavigationBarContrast});
   try {window.setNavigationBarContrastEnforced(attrs.getBoolean(0,true));} finally {attrs.recycle();}
  }
  if (Build.VERSION.SDK_INT>=28) {
   android.view.WindowManager.LayoutParams attrs=window.getAttributes();
   attrs.layoutInDisplayCutoutMode=Build.VERSION.SDK_INT>=30?android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS:android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
   window.setAttributes(attrs);
  }
 }
 public static int importantForAccessibility(android.view.View view) { return view.getImportantForAccessibility(); }
 public static void initializeAccessibility(android.view.View view,androidx.core.view.accessibility.AccessibilityNodeInfoCompat node) {
  view.onInitializeAccessibilityNodeInfo(node.unwrap());
 }
}
