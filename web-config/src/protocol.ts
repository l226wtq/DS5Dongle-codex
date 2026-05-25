import type { HIDDevice } from './hid-types';

export const REPORT_COMMAND = 0xf6;
export const REPORT_CONFIG = 0xf7;
export const REPORT_FIRMWARE = 0xf8;
export const REPORT_RSSI = 0xf9;
export const REPORT_HARDWARE = 0xfa;

export const SONY_VENDOR_ID = 0x054c;
export const DS5_PRODUCT_ID = 0x0ce6;
export const DSE_PRODUCT_ID = 0x0df2;
export const CONFIG_SIZE = 15;

export type ProtocolVersion = 1 | 2;

export interface BaseConfig {
  protocolVersion: ProtocolVersion;
  hapticsGain: number;
  inactiveTime: number;
  disableInactiveDisconnect: boolean;
  disablePicoLed: boolean;
  pollingRateMode: 0 | 1 | 2;
  audioBufferLength: number;
  controllerMode: 0 | 1 | 2;
}

export interface LegacyConfig extends BaseConfig {
  protocolVersion: 1;
  speakerVolumeDb: number;
}

export interface DevConfig extends BaseConfig {
  protocolVersion: 2;
  speakerVolume: number;
  headsetVolume: number;
  syncSpeakerHeadsetVolume: boolean;
  speakerGain: number;
}

export type BridgeConfig = LegacyConfig | DevConfig;

export interface DecodedConfig {
  config: BridgeConfig;
  rawBytes: Uint8Array;
  offset: number;
}

export interface HardwareStatus {
  version: number;
  uptimeMs: number;
  sysClockKhz: number;
  temperatureC: number;
  loopLoadPermille: number;
  loopIterationsPerSec: number;
  controllerConnected: boolean;
  speakerActive: boolean;
  rawBytes: Uint8Array;
}

export class BridgeConfigError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BridgeConfigError';
  }
}

export const defaultConfig: LegacyConfig = {
  protocolVersion: 1,
  hapticsGain: 1,
  speakerVolumeDb: -100,
  inactiveTime: 30,
  disableInactiveDisconnect: false,
  disablePicoLed: false,
  pollingRateMode: 0,
  audioBufferLength: 64,
  controllerMode: 2,
};

export function deviceMatchesBridge(device: Pick<HIDDevice, 'vendorId' | 'productId'>) {
  return (
    device.vendorId === SONY_VENDOR_ID &&
    (device.productId === DS5_PRODUCT_ID || device.productId === DSE_PRODUCT_ID)
  );
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

export function productLabel(productId: number) {
  if (productId === DS5_PRODUCT_ID) {
    return 'DS5';
  }
  if (productId === DSE_PRODUCT_ID) {
    return 'DSE';
  }
  return `0x${productId.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function decodeConfig(input: DataView | Uint8Array): DecodedConfig {
  const bytes = toUint8Array(input);
  const candidates = [0, 1]
    .map((offset) => decodeAtOffset(bytes, offset))
    .filter((candidate): candidate is DecodedConfig => candidate !== null);

  const valid = candidates.find(({ config }) => validateConfig(config).length === 0);
  if (valid) {
    return valid;
  }

  const versions = candidates.map(({ config }) => config.protocolVersion).join(', ');
  throw new BridgeConfigError('invalidConfig', {
    expectedBytes: CONFIG_SIZE,
    actualBytes: bytes.byteLength,
    versions,
    rawBytes: bytesToHex(bytes),
  });
}

export function encodeConfig(config: BridgeConfig) {
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new BridgeConfigError('invalidConfig', { issues });
  }

  const bytes = new Uint8Array(CONFIG_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, config.protocolVersion);
  view.setFloat32(1, config.hapticsGain, true);

  if (config.protocolVersion === 1) {
    view.setFloat32(5, config.speakerVolumeDb, true);
  } else {
    view.setUint8(5, config.speakerVolume);
    view.setUint8(6, config.headsetVolume);
    view.setUint8(7, Number(config.syncSpeakerHeadsetVolume));
    view.setUint8(8, config.speakerGain);
  }

  view.setUint8(9, config.inactiveTime);
  view.setUint8(10, Number(config.disableInactiveDisconnect));
  view.setUint8(11, Number(config.disablePicoLed));
  view.setUint8(12, config.pollingRateMode);
  view.setUint8(13, config.audioBufferLength);
  view.setUint8(14, config.controllerMode);
  return bytes;
}

export async function readConfig(device: HIDDevice) {
  return decodeConfig(await device.receiveFeatureReport(REPORT_CONFIG));
}

export async function readFirmwareVersion(device: HIDDevice) {
  const bytes = toUint8Array(await device.receiveFeatureReport(REPORT_FIRMWARE));
  return new TextDecoder()
    .decode(trimTrailingZeros(stripReportId(bytes, REPORT_FIRMWARE)))
    .trim();
}

export async function readRssi(device: HIDDevice) {
  const bytes = stripReportId(toUint8Array(await device.receiveFeatureReport(REPORT_RSSI)), REPORT_RSSI);
  if (bytes.byteLength === 0) {
    return null;
  }
  return new Int8Array(bytes.buffer, bytes.byteOffset, 1)[0];
}

export async function readHardwareStatus(device: HIDDevice): Promise<HardwareStatus> {
  const bytes = stripReportId(toUint8Array(await device.receiveFeatureReport(REPORT_HARDWARE)), REPORT_HARDWARE);
  if (bytes.byteLength < 19) {
    throw new BridgeConfigError('invalidHardwareStatus', {
      expectedBytes: 19,
      actualBytes: bytes.byteLength,
      rawBytes: bytesToHex(bytes),
    });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: view.getUint8(0),
    uptimeMs: view.getUint32(1, true),
    sysClockKhz: view.getUint32(5, true),
    temperatureC: view.getInt16(9, true) / 100,
    loopLoadPermille: view.getUint16(11, true),
    loopIterationsPerSec: view.getUint32(13, true),
    controllerConnected: view.getUint8(17) === 1,
    speakerActive: view.getUint8(18) === 1,
    rawBytes: bytes.slice(0, 19),
  };
}

export async function applyConfig(device: HIDDevice, config: BridgeConfig) {
  const bytes = encodeConfig(config);
  const payload = new Uint8Array(CONFIG_SIZE + 1);
  payload[0] = 0x01;
  payload.set(bytes, 1);
  await device.sendFeatureReport(REPORT_COMMAND, payload);
  return bytes;
}

export async function saveConfig(device: HIDDevice) {
  await device.sendFeatureReport(REPORT_COMMAND, new Uint8Array([0x02]));
}

export async function reconnectUsb(device: HIDDevice) {
  await device.sendFeatureReport(REPORT_COMMAND, new Uint8Array([0x03]));
}

export function resetConfig(protocolVersion: ProtocolVersion): BridgeConfig {
  if (protocolVersion === 2) {
    return {
      protocolVersion: 2,
      hapticsGain: 1,
      speakerVolume: 0,
      headsetVolume: 0,
      syncSpeakerHeadsetVolume: false,
      speakerGain: 0,
      inactiveTime: 30,
      disableInactiveDisconnect: false,
      disablePicoLed: false,
      pollingRateMode: 0,
      audioBufferLength: 64,
      controllerMode: 2,
    };
  }
  return { ...defaultConfig };
}

export function validateConfig(config: BridgeConfig) {
  const issues: string[] = [];
  if (!Number.isFinite(config.hapticsGain) || config.hapticsGain < 1 || config.hapticsGain > 2) {
    issues.push('hapticsGain');
  }
  if (!Number.isInteger(config.inactiveTime) || config.inactiveTime < 5 || config.inactiveTime > 60) {
    issues.push('inactiveTime');
  }
  if (![0, 1, 2].includes(config.pollingRateMode)) {
    issues.push('pollingRateMode');
  }
  if (!Number.isInteger(config.audioBufferLength) || config.audioBufferLength < 16 || config.audioBufferLength > 128) {
    issues.push('audioBufferLength');
  }
  if (![0, 1, 2].includes(config.controllerMode)) {
    issues.push('controllerMode');
  }

  if (config.protocolVersion === 1) {
    if (!Number.isFinite(config.speakerVolumeDb) || config.speakerVolumeDb < -100 || config.speakerVolumeDb > 0) {
      issues.push('speakerVolumeDb');
    }
  } else {
    if (!Number.isInteger(config.speakerVolume) || config.speakerVolume < 0 || config.speakerVolume > 127) {
      issues.push('speakerVolume');
    }
    if (!Number.isInteger(config.headsetVolume) || config.headsetVolume < 0 || config.headsetVolume > 127) {
      issues.push('headsetVolume');
    }
    if (!Number.isInteger(config.speakerGain) || config.speakerGain < 0 || config.speakerGain > 7) {
      issues.push('speakerGain');
    }
  }

  return issues;
}

function decodeAtOffset(bytes: Uint8Array, offset: number): DecodedConfig | null {
  if (bytes.byteLength - offset < CONFIG_SIZE) {
    return null;
  }

  const rawBytes = bytes.slice(offset, offset + CONFIG_SIZE);
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, CONFIG_SIZE);
  const version = view.getUint8(0);

  if (version === 1) {
    return {
      offset,
      rawBytes,
      config: {
        protocolVersion: 1,
        hapticsGain: view.getFloat32(1, true),
        speakerVolumeDb: view.getFloat32(5, true),
        inactiveTime: view.getUint8(9),
        disableInactiveDisconnect: view.getUint8(10) === 1,
        disablePicoLed: view.getUint8(11) === 1,
        pollingRateMode: view.getUint8(12) as 0 | 1 | 2,
        audioBufferLength: view.getUint8(13),
        controllerMode: view.getUint8(14) as 0 | 1 | 2,
      },
    };
  }

  if (version === 2) {
    return {
      offset,
      rawBytes,
      config: {
        protocolVersion: 2,
        hapticsGain: view.getFloat32(1, true),
        speakerVolume: view.getUint8(5),
        headsetVolume: view.getUint8(6),
        syncSpeakerHeadsetVolume: view.getUint8(7) === 1,
        speakerGain: view.getUint8(8),
        inactiveTime: view.getUint8(9),
        disableInactiveDisconnect: view.getUint8(10) === 1,
        disablePicoLed: view.getUint8(11) === 1,
        pollingRateMode: view.getUint8(12) as 0 | 1 | 2,
        audioBufferLength: view.getUint8(13),
        controllerMode: view.getUint8(14) as 0 | 1 | 2,
      },
    };
  }

  return null;
}

function toUint8Array(input: DataView | Uint8Array) {
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function stripReportId(bytes: Uint8Array, reportId: number) {
  if (bytes[0] === reportId && bytes.byteLength > 1) {
    return bytes.slice(1);
  }
  return bytes;
}

function trimTrailingZeros(bytes: Uint8Array) {
  let end = bytes.byteLength;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return bytes.slice(0, end);
}
