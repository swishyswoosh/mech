// Source-level patches for pinned upstream releases. Fail closed on source drift.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const patches = [
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/VirtualView.java',
    'UIManagerHelper.getEventDispatcherForReactTag(mContext, getId())', 'UIManagerHelper.getEventDispatcher(mContext)'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/ImageView.java',
    'UIManagerHelper.getEventDispatcherForReactTag(mContext, getId())', 'UIManagerHelper.getEventDispatcher(mContext)'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/TSpanView.java',
    'import com.facebook.react.views.text.ReactFontManager;', 'import com.facebook.react.common.assets.ReactFontManager;'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/RenderableViewManager.java',
    'transforms, sTransformDecompositionArray, view.getWidth(), view.getHeight(), null, false)',
    'transforms, sTransformDecompositionArray, view.getWidth(), view.getHeight(), null)'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/RenderableViewManager.java',
    'MapBuilder.of("registrationName", "onSvgLayout")', 'java.util.Collections.singletonMap("registrationName", "onSvgLayout")'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/RenderableViewManager.java',
    'MapBuilder.of("registrationName", "onLoad")', 'java.util.Collections.singletonMap("registrationName", "onLoad")'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/SvgPackage.java',
    'MapBuilder.newHashMap()', 'new HashMap<>()'],
  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/SvgPackage.java',
    'reactModuleInfoProviderClass.newInstance()', 'reactModuleInfoProviderClass.getDeclaredConstructor().newInstance()'],

  ['react-native-svg', '15.16.1', 'android/src/main/java/com/horcrux/svg/SvgPackage.java',
    'catch (InstantiationException | IllegalAccessException e)', 'catch (ReflectiveOperationException e)'],
  ["react-native-svg", "15.16.1", "android/src/main/java/com/horcrux/svg/GroupView.java", "    if (mOpacity != 1) {\n      if (mLayerBitmap == null) {\n        mLayerBitmap =\n            Bitmap.createBitmap(canvas.getWidth(), canvas.getHeight(), Bitmap.Config.ARGB_8888);\n        mLayerCanvas = new Canvas(mLayerBitmap);\n      } else {\n        mLayerBitmap.recycle();\n        mLayerBitmap =\n            Bitmap.createBitmap(canvas.getWidth(), canvas.getHeight(), Bitmap.Config.ARGB_8888);\n        mLayerCanvas.setBitmap(mLayerBitmap);\n      }\n      // Copy current matrix from original canvas\n      mLayerCanvas.save();\n      mLayerCanvas.setMatrix(canvas.getMatrix());\n    } else {\n      mLayerCanvas = canvas;\n    }\n", "    // A native opacity layer preserves the canvas transform and clipping state.\n    // It avoids copying the deprecated Canvas matrix and a full-screen bitmap.\n    final int opacityLayer = mOpacity != 1\n        ? canvas.saveLayerAlpha(null, (int) (mOpacity * 255)) : -1;\n    mLayerCanvas = canvas;\n"],
  ["react-native-svg", "15.16.1", "android/src/main/java/com/horcrux/svg/GroupView.java", "    if (mOpacity != 1) {\n      // Restore copied canvas and temporary reset original canvas matrix to draw bitmap 1:1\n      mLayerCanvas.restore();\n      int saveCount = canvas.save();\n      canvas.setMatrix(null);\n      mLayerPaint.setAlpha((int) (mOpacity * 255));\n      if (mLayerBitmap != null) {\n        canvas.drawBitmap(mLayerBitmap, 0, 0, mLayerPaint);\n      }\n      canvas.restoreToCount(saveCount);\n    }\n", "    if (opacityLayer != -1) canvas.restoreToCount(opacityLayer);\n"],
];
for (const [pkg, version, relative, before, after] of patches) {
  const base = path.join(root, 'node_modules', pkg);
  if (JSON.parse(fs.readFileSync(path.join(base, 'package.json'))).version !== version)
    throw new Error(`Review modern API patch for new ${pkg} version`);
  const file = path.join(base, relative), source = fs.readFileSync(file, 'utf8');
  if (source.includes(after) && !source.includes(before)) continue;
  if (source.split(before).length !== 2) throw new Error(`Patch context changed: ${file}`);
  fs.writeFileSync(file, source.replace(before, after));
}
