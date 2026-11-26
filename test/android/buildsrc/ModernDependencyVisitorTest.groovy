import org.junit.Test
import org.objectweb.asm.*
import static org.junit.Assert.*
class ModernDependencyVisitorTest {
 @Test void replacesOnlyAuditedDisplayInitialization() {
  def out = new ClassWriter(0)
  def visitor = new ModernDependencyVisitor(out, 'com.facebook.react.uimanager.DisplayMetricsHolder')
  visitor.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, 'com/facebook/react/uimanager/DisplayMetricsHolder', null, 'java/lang/Object', null)
  def method = visitor.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, 'initDisplayMetrics', '(Landroid/content/Context;)V', null, null)
  if(method != null) { method.visitCode(); method.visitInsn(Opcodes.RETURN); method.visitMaxs(0,1); method.visitEnd() }
  visitor.visitEnd()
  def calls=[]
  new ClassReader(out.toByteArray()).accept(new ClassVisitor(Opcodes.ASM9) {
   MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] exceptions) {
    new MethodVisitor(Opcodes.ASM9) {
     void visitMethodInsn(int op,String owner,String calledName,String calledDesc,boolean itf) { calls.add(owner+'.'+calledName+calledDesc) }
    }
   }
  },0)
  assertEquals(['local/r2controller/ModernDependencyApis.initDisplayMetrics(Landroid/content/Context;)V'],calls)
 }
 @Test void replacesActiveStatusBarPathWithoutLegacyWindowFlags() {
  def out = new ClassWriter(0)
  def visitor = new ModernDependencyVisitor(out, 'com.facebook.react.views.view.WindowUtilKt')
  visitor.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, 'com/facebook/react/views/view/WindowUtilKt', null, 'java/lang/Object', null)
  def method = visitor.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, 'setStatusBarVisibility', '(Landroid/view/Window;Z)V', null, null)
  if(method != null) { method.visitCode(); method.visitInsn(Opcodes.RETURN); method.visitMaxs(0,2); method.visitEnd() }
  visitor.visitEnd()
  def calls=[]
  new ClassReader(out.toByteArray()).accept(new ClassVisitor(Opcodes.ASM9) {
   MethodVisitor visitMethod(int access,String methodName,String descriptor,String sig,String[] exceptions) {
    new MethodVisitor(Opcodes.ASM9) {
     void visitMethodInsn(int op,String owner,String calledName,String calledDesc,boolean itf) { calls.add(owner+'.'+calledName+calledDesc) }
    }
   }
  },0)
  assertEquals(['local/r2controller/ModernDependencyApis.setStatusBarVisibility(Landroid/view/Window;Z)V'],calls)
 }
 @Test void textInputColorFilterUsesObjectOverload() {
  def out=new ClassWriter(0)
  def visitor=new ModernDependencyVisitor(out,'com.facebook.react.views.textinput.ReactTextInputManager')
  visitor.visit(Opcodes.V17,Opcodes.ACC_PUBLIC,'Fixture',null,'java/lang/Object',null)
  def method=visitor.visitMethod(Opcodes.ACC_STATIC,'paint','(Landroid/graphics/drawable/Drawable;ILandroid/graphics/PorterDuff$Mode;)V',null,null)
  method.visitCode();method.visitVarInsn(Opcodes.ALOAD,0);method.visitVarInsn(Opcodes.ILOAD,1);method.visitVarInsn(Opcodes.ALOAD,2)
  method.visitMethodInsn(Opcodes.INVOKEVIRTUAL,'android/graphics/drawable/Drawable','setColorFilter','(ILandroid/graphics/PorterDuff$Mode;)V',false)
  method.visitInsn(Opcodes.RETURN);method.visitMaxs(3,3);method.visitEnd();visitor.visitEnd()
  def calls=[]
  new ClassReader(out.toByteArray()).accept(new ClassVisitor(Opcodes.ASM9) {
   MethodVisitor visitMethod(int access,String name,String desc,String sig,String[] ex) {
    new MethodVisitor(Opcodes.ASM9) {
     void visitMethodInsn(int op,String owner,String calledName,String calledDesc,boolean itf){calls.add(owner+'.'+calledName+calledDesc)}
    }
   }
  },0)
  assertEquals(['local/r2controller/ModernDependencyApis.setColorFilter(Landroid/graphics/drawable/Drawable;ILandroid/graphics/PorterDuff$Mode;)V'],calls)
 }
}
