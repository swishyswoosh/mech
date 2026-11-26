import {paletteFor} from "../../app/theme/appearance.ts";
import {loadInterface} from "../../app/library/interfacePreferences.ts";
import { useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  View,
  StatusBar,
} from "react-native";
import type { DroidSession } from "../../app/session/DroidSession.ts";
import { ControllerApp } from "../../app/App.tsx";
import { createAndroidSession } from "./droidSession.ts";
import { events, native } from "./transport";

import {DevicePicker} from './DevicePicker.tsx';
import {mergeDevice} from './devicePicker.ts';
import type {DiscoveredDroid as Device} from './devicePicker.ts';
export default function App() {
  const [devices, setDevices] = useState<Device[]>([]),
    [picking, setPicking] = useState(false);
  const choose = useRef<{
    resolve: (device: { id: string; name?: string }) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const port = useRef<DroidSession | null>(null);
  const cancelPicker = useRef<() => void>(() => {});
  const dispose = useRef<() => void>(() => {});
  if (!port.current) {
    const result = createAndroidSession({
      native,
      events,
      permissions: async () => {
        const required =
          Number(Platform.Version) >= 31
            ? [
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              ]
            : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
        const grants = await PermissionsAndroid.requestMultiple(required);
        if (
          required.some(
            (permission) =>
              grants[permission] !== PermissionsAndroid.RESULTS.GRANTED,
          )
        )
          throw new Error(
            "Bluetooth scan and connection permissions are required.",
          );
      },
      choose: () => {
        setDevices([]);
        setPicking(true);
        return new Promise<{ id: string; name?: string }>((resolve, reject) => {
          choose.current = { resolve, reject };
        });
      },
      cancelChoice: () => {
        choose.current?.reject(new Error("Droid selection cancelled"));
        choose.current = null;
        setPicking(false);
      },
    });
    port.current = result.session;
    dispose.current = result.dispose;
    cancelPicker.current = () => {
      void result.session.disconnect();
    };
  }

  useEffect(() => {
    const deviceListener = events.addListener("R2BleDevice", (device: Device) =>
      setDevices((old) => mergeDevice(old,device)),
    );
    return () => {
      deviceListener.remove();
      dispose.current();
    };
  }, []);
  const [appearance, setAppearance] = useState<"light"|"dark">(() => loadInterface(port.current!).theme === "light" ? "light" : "dark");
  const colors = paletteFor(appearance);
  const cancel = () => cancelPicker.current();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar hidden barStyle="light-content"/>
      <ControllerApp port={port.current} platform="android" onAppearanceChange={setAppearance} />
      {picking && <DevicePicker devices={devices} appearance={appearance} onCancel={cancel}
        onChoose={device => {
          const pending=choose.current;choose.current=null;
          pending?.resolve({id:device.id,name:device.name??undefined});
        }}/>}
    </View>
  );
}
