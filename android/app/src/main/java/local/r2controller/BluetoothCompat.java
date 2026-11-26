package local.r2controller;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothStatusCodes;
import android.os.Build;

/** Explicit byte writes on API 33+, isolated immutable write values on API 26–32. */
final class BluetoothCompat {
 private BluetoothCompat() {}
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static boolean write(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] bytes, int type) {
  if (Build.VERSION.SDK_INT >= 33) return GattWriteValue.submit(bytes,type,(value,writeType)->gatt.writeCharacteristic(characteristic,value,writeType));
  return legacyWrite(gatt,characteristic,bytes,type);
 }
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static boolean subscribe(BluetoothGatt gatt, BluetoothGattDescriptor descriptor) {
  if (Build.VERSION.SDK_INT >= 33) return gatt.writeDescriptor(descriptor,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)==BluetoothStatusCodes.SUCCESS;
  return legacySubscribe(gatt,descriptor);
 }
 // API 26–32: explicit-value writes were introduced in API 33. Never mutate the
 // discovered characteristic: Android 8 can replace its value on a binder thread
 // even while a callback handler is configured. The snapshot is not registered
 // with the service, so notifications cannot overwrite it. Covered on 26/29/32.
 @SuppressWarnings("deprecation")
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 private static boolean legacyWrite(BluetoothGatt gatt,BluetoothGattCharacteristic original,byte[] bytes,int type) {
  return gatt.writeCharacteristic(snapshot(original,bytes,type));
 }
 // CCCD has no incoming characteristic-notification mutations; writes serialize
 // through the existing single-operation GATT queue. Replacement needs API 33.
 @SuppressWarnings("deprecation")
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 private static boolean legacySubscribe(BluetoothGatt gatt,BluetoothGattDescriptor descriptor) {
  descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE.clone());
  return gatt.writeDescriptor(descriptor);
 }
 static BluetoothGattCharacteristic snapshot(BluetoothGattCharacteristic original,byte[] bytes,int type) {
  final byte[] frozen=bytes.clone();
  final int instanceId=original.getInstanceId();
  final BluetoothGattService service=original.getService();
  return new BluetoothGattCharacteristic(original.getUuid(),original.getProperties(),original.getPermissions()) {
   @Override public int getInstanceId(){return instanceId;}
   @Override public BluetoothGattService getService(){return service;}
   @Override public int getWriteType(){return type;}
   @Override @SuppressWarnings("deprecation") public byte[] getValue(){return frozen.clone();}
  };
 }
 // Pre-33 callback payload must be copied synchronously before dispatching it.
 @SuppressWarnings("deprecation")
 static byte[] notificationValue(BluetoothGattCharacteristic characteristic) {
  byte[] bytes=characteristic.getValue();return bytes==null?new byte[0]:bytes.clone();
 }
}
