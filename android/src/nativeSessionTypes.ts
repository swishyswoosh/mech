import type { NativeBridge } from "../../core/transports/androidCore.ts";
export interface NativeSessionApi extends NativeBridge {
  preferences?: Record<string, string>;
  scan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  heartbeat(): void;
  rearmManualInput(): void;
  manualIdleAcknowledged(): Promise<void>;
  armSafetyStop(
    service: string,
    frames: string,
    timeout: number,
  ): Promise<void>;
  armDrivePulse(
    id: string,
    service: string,
    demand: string,
    zero: string,
  ): Promise<void>;
  awaitDrivePulse(id: string): Promise<void>;
  cancelDrivePulse(id: string): Promise<void>;
  acquireSourceLease(id: string, drive: boolean): Promise<void>;
  renewSourceLease(id: string): void;
  releaseSourceLease(id: string): void;
  savePreference(key: string, value: string): Promise<void>;
  loadBatteryProfiling?():string|null;
  saveBatteryProfiling?(value:string,expected:string|null):Promise<void>;
  importLocalJson(): Promise<string>;
  importLocalJsonFiles(): Promise<Array<{ name: string; text: string }>>;
  exportLocalJson(name: string, text: string): Promise<void>;
  hashLocalText(text: string): Promise<{ sha256: string; bytes: number }>;
}
export interface NativeEvents {
  addListener(name: string, callback: (event: any) => void): { remove(): void };
}
