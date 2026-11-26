package local.r2controller;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import java.util.HashMap;
import java.util.Map;

public final class R2AppInfoModule extends ReactContextBaseJavaModule {
  public R2AppInfoModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "R2AppInfo"; }
  @Override public Map<String, Object> getConstants() {
    Map<String, Object> info = new HashMap<>();
    info.put("versionName", BuildConfig.VERSION_NAME);
    info.put("versionCode", BuildConfig.VERSION_CODE);
    return info;
  }
}
