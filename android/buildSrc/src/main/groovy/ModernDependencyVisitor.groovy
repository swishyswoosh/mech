import org.objectweb.asm.*
/** Replace deprecated upstream methods without suppressing API checks. */
class ModernDependencyVisitor extends ClassVisitor {
 private final String className
 ModernDependencyVisitor(ClassVisitor next, String name) { super(Opcodes.ASM9, next); className = name }
 @Override MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
  def next = super.visitMethod(access, name, descriptor, signature, exceptions)
  boolean metrics = className == 'com.facebook.react.uimanager.DisplayMetricsHolder' && name == 'initDisplayMetrics' && descriptor == '(Landroid/content/Context;)V'
  boolean statusBar = className == 'com.facebook.react.views.view.WindowUtilKt' && [
   setStatusBarVisibility:'(Landroid/view/Window;Z)V', setStatusBarStyle:'(Landroid/view/Window;Ljava/lang/String;)V',
   enableEdgeToEdge:'(Landroid/view/Window;)V', disableEdgeToEdge:'(Landroid/view/Window;)V'
  ][name] == descriptor
  if (metrics || statusBar) {
   next.visitCode()
   next.visitVarInsn(Opcodes.ALOAD, 0)
   if (statusBar && name == 'setStatusBarVisibility') next.visitVarInsn(Opcodes.ILOAD, 1)
   if (statusBar && name == 'setStatusBarStyle') next.visitVarInsn(Opcodes.ALOAD, 1)
   next.visitMethodInsn(Opcodes.INVOKESTATIC, 'local/r2controller/ModernDependencyApis', name, descriptor, false)
   next.visitInsn(Opcodes.RETURN)
   next.visitMaxs(statusBar ? 2 : 1,statusBar ? 2 : 1)
   next.visitEnd()
   return null
  }
  return new MethodVisitor(Opcodes.ASM9,next) {
   @Override void visitMethodInsn(int op,String owner,String calledName,String desc,boolean itf) {
    if (owner == 'android/graphics/drawable/Drawable' && calledName == 'setColorFilter' && desc == '(ILandroid/graphics/PorterDuff$Mode;)V') {
     super.visitMethodInsn(Opcodes.INVOKESTATIC,'local/r2controller/ModernDependencyApis',calledName,'(Landroid/graphics/drawable/Drawable;ILandroid/graphics/PorterDuff$Mode;)V',false)
    } else if (className.startsWith('com.facebook.react.uimanager.ReactAccessibilityDelegate') && owner == 'android/os/Handler' && calledName == '<init>' && desc == '()V') {
     super.visitMethodInsn(Opcodes.INVOKESTATIC,'android/os/Looper','getMainLooper','()Landroid/os/Looper;',false)
     super.visitMethodInsn(op,owner,calledName,'(Landroid/os/Looper;)V',itf)
    } else if (owner == 'androidx/core/view/ViewCompat' && calledName == 'getImportantForAccessibility' && desc == '(Landroid/view/View;)I') {
     super.visitMethodInsn(Opcodes.INVOKESTATIC,'local/r2controller/ModernDependencyApis','importantForAccessibility',desc,false)
    } else if (owner == 'androidx/core/view/ViewCompat' && calledName == 'onInitializeAccessibilityNodeInfo' && desc == '(Landroid/view/View;Landroidx/core/view/accessibility/AccessibilityNodeInfoCompat;)V') {
     super.visitMethodInsn(Opcodes.INVOKESTATIC,'local/r2controller/ModernDependencyApis','initializeAccessibility',desc,false)
    } else super.visitMethodInsn(op,owner,calledName,desc,itf)
   }
   @Override void visitFieldInsn(int op,String owner,String fieldName,String desc) {
    if (className == 'com.facebook.react.modules.systeminfo.AndroidInfoModule' && owner == 'android/os/Build' && fieldName == 'SERIAL') super.visitLdcInsn('unknown')
    else super.visitFieldInsn(op,owner,fieldName,desc)
   }
  }
 }
}
