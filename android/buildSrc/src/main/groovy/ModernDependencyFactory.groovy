import com.android.build.api.instrumentation.*
import org.objectweb.asm.ClassVisitor
abstract class ModernDependencyFactory implements AsmClassVisitorFactory<InstrumentationParameters.None> {
 @Override boolean isInstrumentable(ClassData data) { data.className.startsWith('com.facebook.react.uimanager.ReactAccessibilityDelegate') || data.className in ['com.facebook.react.uimanager.DisplayMetricsHolder', 'com.facebook.react.views.view.WindowUtilKt', 'com.facebook.react.views.textinput.ReactTextInputManager', 'com.facebook.react.modules.systeminfo.AndroidInfoModule'] }
 @Override ClassVisitor createClassVisitor(ClassContext context, ClassVisitor next) {
  new ModernDependencyVisitor(next, context.currentClassData.className)
 }
}
