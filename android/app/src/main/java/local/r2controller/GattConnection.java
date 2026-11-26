package local.r2controller;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattConnectionSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;

/** One connection policy; callbacks stay on the existing serialized radio worker. */
final class GattConnection {
 private GattConnection() {}
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static boolean setControlForeground(BluetoothGatt gatt,boolean foreground){return gatt.requestConnectionPriority(foreground?BluetoothGatt.CONNECTION_PRIORITY_HIGH:BluetoothGatt.CONNECTION_PRIORITY_BALANCED);}
 @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static BluetoothGatt connect(BluetoothDevice device, Context context, Handler radio, BluetoothGattCallback callback) {
  if (Build.VERSION.SDK_INT >= 37) return Api37.connect(device, radio, callback);
  return Legacy.connect(device, context, radio, callback);
 }
 private static final class Legacy {
  // API 37's replacement is unavailable on API 26–36; retain this guarded
  // compatibility call for older devices, including the Galaxy S9.
  @SuppressWarnings("deprecation")
  @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static BluetoothGatt connect(BluetoothDevice device, Context context, Handler radio, BluetoothGattCallback callback) {
   return device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE,
       BluetoothDevice.PHY_LE_1M_MASK, Build.VERSION.SDK_INT < 29 ? null : radio);
  }
 }
 @androidx.annotation.RequiresApi(37)
 private static final class Api37 {
  @androidx.annotation.RequiresPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
 static BluetoothGatt connect(BluetoothDevice device, Handler radio, BluetoothGattCallback callback) {
   BluetoothGattConnectionSettings settings = new BluetoothGattConnectionSettings.Builder()
       .setAutoConnectEnabled(false).setTransport(BluetoothDevice.TRANSPORT_LE)
       .setAutomaticMtuEnabled(false).build();
   return device.connectGatt(settings, command -> radio.post(command), callback);
  }
 }
}
