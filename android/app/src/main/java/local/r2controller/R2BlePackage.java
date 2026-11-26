package local.r2controller;
import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.*;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.uimanager.ViewManager;
import java.util.*;

public class R2BlePackage extends BaseReactPackage {
  @Override public NativeModule getModule(String name, ReactApplicationContext context) {
    switch (name) {
      case "R2AppInfo": return new R2AppInfoModule(context);
      case "R2Ble": return new R2BleModule(context);
      case "R2ExternalInput": return new R2ExternalInputModule(context);
      case "R2CockpitPlatform": return new R2CockpitPlatformModule(context);
      default: return null;
    }
  }
  @Override public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> {
      Map<String,ReactModuleInfo> modules = new HashMap<>();
      for(String name : new String[]{"R2AppInfo", "R2Ble", "R2ExternalInput", "R2CockpitPlatform"})
        modules.put(name, new ReactModuleInfo(name, "local.r2controller." + name + "Module", false, false, false, false));
      return modules;
    };
  }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Arrays.asList(new R2InputViews.SliderManager(), new R2InputViews.DriveManager());
  }
}
