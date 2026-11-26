package local.r2controller;
import com.facebook.react.ReactActivity;
public class MainActivity extends ReactActivity {
  private java.util.function.Consumer<androidx.activity.result.ActivityResult> documentResult;
  private final androidx.activity.result.ActivityResultLauncher<android.content.Intent> documentLauncher =
      registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(), result -> {
        java.util.function.Consumer<androidx.activity.result.ActivityResult> callback=documentResult;
        documentResult=null;if(callback!=null)callback.accept(result);
      });
  void launchDocument(android.content.Intent intent,java.util.function.Consumer<androidx.activity.result.ActivityResult> callback){
    if(documentResult!=null)throw new IllegalStateException("A local document picker is already open");
    documentResult=callback;try{documentLauncher.launch(intent);}catch(RuntimeException error){documentResult=null;throw error;}
  }

  @Override protected void onCreate(android.os.Bundle state) {
    super.onCreate(state);
    android.view.View content = findViewById(android.R.id.content);
    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
      androidx.core.graphics.Insets bars = insets.getInsets(
          androidx.core.view.WindowInsetsCompat.Type.systemBars() |
          androidx.core.view.WindowInsetsCompat.Type.displayCutout());
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return insets;
    });
    androidx.core.view.ViewCompat.requestApplyInsets(content);
  }
  @Override public boolean dispatchKeyEvent(android.view.KeyEvent event){return R2ExternalInputModule.dispatchKey(event)||super.dispatchKeyEvent(event);}
  @Override public boolean dispatchGenericMotionEvent(android.view.MotionEvent event){return R2ExternalInputModule.dispatchMotion(event)||super.dispatchGenericMotionEvent(event);}
  @Override public void onWindowFocusChanged(boolean focused){
    super.onWindowFocusChanged(focused);
    R2ExternalInputModule.windowFocus(focused);
    // Old Android can restore system bars during a Home/return transition even
    // though the unchanged React StatusBar prop is still hidden.
    if(focused) ModernDependencyApis.setStatusBarVisibility(getWindow(),true);
  }
  @Override protected com.facebook.react.ReactActivityDelegate createReactActivityDelegate() {
    return new com.facebook.react.defaults.DefaultReactActivityDelegate(this, getMainComponentName());
  }
  @Override protected String getMainComponentName() { return "R2Controller"; }
}
