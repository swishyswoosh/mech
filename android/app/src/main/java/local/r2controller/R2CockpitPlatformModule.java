package local.r2controller;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.view.HapticFeedbackConstants;
import android.view.View;
import com.facebook.react.bridge.*;

/** UI-only hooks. Neither orientation nor feedback issues a droid command. */
public final class R2CockpitPlatformModule extends ReactContextBaseJavaModule {
 private boolean cockpit;
 private boolean devicePicker;
 private int pickerPreviousOrientation=ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
 private int previousOrientation=ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
 public R2CockpitPlatformModule(ReactApplicationContext context){super(context);}
 @Override public String getName(){return "R2CockpitPlatform";}
 @ReactMethod public void setCockpit(boolean active){UiThreadUtil.runOnUiThread(()->{
  Activity activity=getReactApplicationContext().getCurrentActivity();if(activity==null||active==cockpit)return;
  if(active){previousOrientation=devicePicker?pickerPreviousOrientation:activity.getRequestedOrientation();cockpit=true;if(devicePicker)pickerPreviousOrientation=ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;else activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);}
  else{cockpit=false;if(devicePicker)pickerPreviousOrientation=previousOrientation;else activity.setRequestedOrientation(previousOrientation);}
 });}
 @ReactMethod public void setDevicePicker(boolean active){UiThreadUtil.runOnUiThread(()->{
  Activity activity=getReactApplicationContext().getCurrentActivity();if(activity==null||active==devicePicker)return;
  if(active){pickerPreviousOrientation=activity.getRequestedOrientation();devicePicker=true;activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_USER);}
  else{devicePicker=false;activity.setRequestedOrientation(pickerPreviousOrientation);}
 });}
 @ReactMethod public void haptic(String kind){UiThreadUtil.runOnUiThread(()->{
  Activity activity=getReactApplicationContext().getCurrentActivity();if(activity==null||!activity.hasWindowFocus())return;
  View view=activity.getWindow().getDecorView();
  int effect="stop".equals(kind)?HapticFeedbackConstants.LONG_PRESS:HapticFeedbackConstants.CLOCK_TICK;
  view.performHapticFeedback(effect);
 });}
 @Override public void invalidate(){setDevicePicker(false);setCockpit(false);super.invalidate();}
}
