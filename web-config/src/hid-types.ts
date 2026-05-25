export type HIDReportData = BufferSource;

export interface HIDDeviceInfo {
  vendorId: number;
  productId: number;
  productName: string;
}

export interface HIDDevice extends HIDDeviceInfo, EventTarget {
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  sendFeatureReport(reportId: number, data: HIDReportData): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}

export interface HIDDeviceRequestOptions {
  filters: Array<{
    vendorId?: number;
    productId?: number;
  }>;
}

export interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
}

declare global {
  interface Navigator {
    hid?: HID;
  }
}

export {};
