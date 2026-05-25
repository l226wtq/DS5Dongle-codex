import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Cable,
  Check,
  Cpu,
  Gamepad2,
  Gauge,
  Languages,
  Moon,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  TerminalSquare,
  Usb,
  Volume2,
  Zap,
} from 'lucide-react';
import type { HIDDevice } from './hid-types';
import {
  applyConfig,
  BridgeConfig,
  bytesToHex,
  CONFIG_SIZE,
  defaultConfig,
  deviceMatchesBridge,
  encodeConfig,
  productLabel,
  readConfig,
  readFirmwareVersion,
  readRssi,
  reconnectUsb,
  resetConfig,
  saveConfig,
  SONY_VENDOR_ID,
  DS5_PRODUCT_ID,
  DSE_PRODUCT_ID,
} from './protocol';
import './styles.css';

type ThemeMode = 'light' | 'dark' | 'system';
type Language = 'zh' | 'en';
type Operation = 'connecting' | 'reading' | 'applying' | 'saving' | 'reconnecting' | null;

interface LogEntry {
  at: string;
  level: 'ok' | 'info' | 'warn' | 'error';
  message: string;
}

const text = {
  zh: {
    appTitle: 'DS5 Bridge 配置',
    ready: '准备连接',
    connected: '已连接',
    disconnected: '未连接',
    noDevice: '无设备',
    device: '设备',
    open: '打开',
    connect: '连接',
    firmware: '固件',
    unknown: '未知',
    state: '状态',
    config: '配置',
    feedback: '反馈输出',
    power: '电源与指示',
    performance: '性能',
    compatibility: '兼容性',
    debug: '调试',
    hapticsGain: '触觉增益',
    speakerVolumeDb: '扬声器音量 dB',
    speakerVolume: '扬声器音量',
    headsetVolume: '耳机音量',
    syncSpeakerHeadsetVolume: '同步扬声器与耳机',
    speakerGain: '扬声器增益',
    inactiveTime: '闲置时间',
    inactiveUnit: '分钟',
    disableInactiveDisconnect: '禁用闲置断连',
    disablePicoLed: '禁用 Pico LED',
    pollingRateMode: '轮询率模式',
    audioBufferLength: '音频缓冲长度',
    controllerMode: '控制器模式',
    apply: '应用',
    read: '读取',
    save: '保存',
    reconnect: '重连 USB',
    reset: '重置',
    rawConfig: '配置原始字节',
    encodedConfig: '将发送字节',
    protocol: '协议',
    byteLength: '字节长度',
    reportIds: 'Report IDs',
    logs: '日志',
    webHidUnavailable: 'WebHID 不可用',
    applied: '已应用到设备',
    saved: '已保存到 Flash',
    readOk: '配置读取完成',
    reconnectSent: '已发送 USB 重连命令',
    resetOk: '已恢复默认配置',
    deviceLost: '设备已断开',
    connectFirst: '请先连接设备',
    legacyMode: '当前固件',
    devMode: 'Dev 音频',
  },
  en: {
    appTitle: 'DS5 Bridge Config',
    ready: 'Ready to connect',
    connected: 'Connected',
    disconnected: 'Disconnected',
    noDevice: 'No device',
    device: 'Device',
    open: 'Open',
    connect: 'Connect',
    firmware: 'Firmware',
    unknown: 'Unknown',
    state: 'State',
    config: 'Configuration',
    feedback: 'Feedback output',
    power: 'Power & indicators',
    performance: 'Performance',
    compatibility: 'Compatibility',
    debug: 'Debug',
    hapticsGain: 'Haptics gain',
    speakerVolumeDb: 'Speaker volume dB',
    speakerVolume: 'Speaker volume',
    headsetVolume: 'Headset volume',
    syncSpeakerHeadsetVolume: 'Sync speaker and headset',
    speakerGain: 'Speaker gain',
    inactiveTime: 'Inactive time',
    inactiveUnit: 'minutes',
    disableInactiveDisconnect: 'Disable inactive disconnect',
    disablePicoLed: 'Disable Pico LED',
    pollingRateMode: 'Polling rate mode',
    audioBufferLength: 'Audio buffer length',
    controllerMode: 'Controller mode',
    apply: 'Apply',
    read: 'Read',
    save: 'Save',
    reconnect: 'Reconnect USB',
    reset: 'Reset',
    rawConfig: 'Raw config bytes',
    encodedConfig: 'Outgoing bytes',
    protocol: 'Protocol',
    byteLength: 'Byte length',
    reportIds: 'Report IDs',
    logs: 'Logs',
    webHidUnavailable: 'WebHID unavailable',
    applied: 'Applied to device',
    saved: 'Saved to flash',
    readOk: 'Config read complete',
    reconnectSent: 'USB reconnect command sent',
    resetOk: 'Defaults restored',
    deviceLost: 'Device disconnected',
    connectFirst: 'Connect a device first',
    legacyMode: 'Current firmware',
    devMode: 'Dev audio',
  },
};

const pollingLabels = ['250 Hz', '500 Hz', 'Real-Time'];
const controllerLabels = ['DS5', 'DSE', 'Auto'];

function App() {
  const [language, setLanguage] = useState<Language>(() => (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [device, setDevice] = useState<HIDDevice | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<HIDDevice[]>([]);
  const [config, setConfig] = useState<BridgeConfig>(defaultConfig);
  const [lastSavedConfig, setLastSavedConfig] = useState<BridgeConfig | null>(null);
  const [rawConfigBytes, setRawConfigBytes] = useState<Uint8Array | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [rssi, setRssi] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const t = text[language];
  const webHidSupported = Boolean(navigator.hid);
  const isConnected = Boolean(device?.opened);
  const isBusy = operation !== null;
  const isDirty = lastSavedConfig ? JSON.stringify(config) !== JSON.stringify(lastSavedConfig) : true;
  const outgoingBytes = useMemo(() => {
    try {
      return encodeConfig(config);
    } catch {
      return null;
    }
  }, [config]);

  const log = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((current) => [
      { at: new Date().toLocaleTimeString(), level, message },
      ...current.slice(0, 79),
    ]);
  }, []);

  const refreshAuthorized = useCallback(async () => {
    if (!navigator.hid) {
      return;
    }
    const devices = (await navigator.hid.getDevices()).filter(deviceMatchesBridge);
    setAuthorizedDevices(devices);
  }, []);

  const withDevice = useCallback(
    async (nextOperation: Exclude<Operation, null>, task: (selected: HIDDevice) => Promise<void>) => {
      if (!device) {
        log('warn', t.connectFirst);
        return;
      }
      try {
        setOperation(nextOperation);
        if (!device.opened) {
          await device.open();
        }
        await task(device);
      } catch (error) {
        log('error', error instanceof Error ? error.message : String(error));
      } finally {
        setOperation(null);
      }
    },
    [device, log, t.connectFirst],
  );

  const readFromDevice = useCallback(
    async (selected: HIDDevice) => {
      const decoded = await readConfig(selected);
      setConfig(decoded.config);
      setLastSavedConfig(decoded.config);
      setRawConfigBytes(decoded.rawBytes);
      log('ok', `${t.readOk}: v${decoded.config.protocolVersion}, offset ${decoded.offset}`);

      const [firmware, nextRssi] = await Promise.allSettled([
        readFirmwareVersion(selected),
        readRssi(selected),
      ]);
      if (firmware.status === 'fulfilled') {
        setFirmwareVersion(firmware.value);
      }
      if (nextRssi.status === 'fulfilled') {
        setRssi(nextRssi.value);
      }
    },
    [log, t.readOk],
  );

  const connect = useCallback(async () => {
    if (!navigator.hid) {
      log('error', t.webHidUnavailable);
      return;
    }
    try {
      setOperation('connecting');
      const [selected] = await navigator.hid.requestDevice({
        filters: [
          { vendorId: SONY_VENDOR_ID, productId: DS5_PRODUCT_ID },
          { vendorId: SONY_VENDOR_ID, productId: DSE_PRODUCT_ID },
        ],
      });
      if (!selected) {
        return;
      }
      await selected.open();
      setDevice(selected);
      await readFromDevice(selected);
      await refreshAuthorized();
      log('ok', `${t.connected}: ${selected.productName || productLabel(selected.productId)}`);
    } catch (error) {
      log('error', error instanceof Error ? error.message : String(error));
    } finally {
      setOperation(null);
    }
  }, [log, readFromDevice, refreshAuthorized, t.connected, t.webHidUnavailable]);

  const openAuthorized = useCallback(
    async (selected: HIDDevice) => {
      try {
        setOperation('connecting');
        await selected.open();
        setDevice(selected);
        await readFromDevice(selected);
        log('ok', `${t.connected}: ${selected.productName || productLabel(selected.productId)}`);
      } catch (error) {
        log('error', error instanceof Error ? error.message : String(error));
      } finally {
        setOperation(null);
      }
    },
    [log, readFromDevice, t.connected],
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    localStorage.setItem('ds5bridge-theme', theme);
  }, [theme, systemDark]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    refreshAuthorized();
    if (!navigator.hid) {
      return;
    }
    const onDisconnect = (event: Event) => {
      const disconnected = (event as Event & { device?: HIDDevice }).device;
      if (disconnected && device && disconnected === device) {
        setDevice(null);
        setRssi(null);
        log('warn', t.deviceLost);
      }
      refreshAuthorized();
    };
    navigator.hid.addEventListener('disconnect', onDisconnect);
    navigator.hid.addEventListener('connect', refreshAuthorized as EventListener);
    return () => {
      navigator.hid?.removeEventListener('disconnect', onDisconnect);
      navigator.hid?.removeEventListener('connect', refreshAuthorized as EventListener);
    };
  }, [device, log, refreshAuthorized, t.deviceLost]);

  useEffect(() => {
    if (!device?.opened) {
      return;
    }
    const id = window.setInterval(async () => {
      try {
        setRssi(await readRssi(device));
      } catch {
        setRssi(null);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [device]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Gamepad2 size={24} /></span>
          <div>
            <span className="eyebrow">WebHID</span>
            <h1>{t.appTitle}</h1>
          </div>
        </div>
        <div className="toolbar" aria-label="Toolbar">
          <IconButton
            title={language === 'zh' ? 'English' : '中文'}
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          >
            <Languages size={18} />
          </IconButton>
          <IconButton title="Theme" onClick={() => setTheme(nextTheme(theme))}>
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </IconButton>
        </div>
      </header>

      {!webHidSupported && (
        <section className="notice">
          <TerminalSquare size={18} />
          <span>{t.webHidUnavailable}</span>
        </section>
      )}

      <section className="device-strip">
        <div className="device-main">
          <div className="device-icon"><Usb size={24} /></div>
          <div>
            <span className="field-label">{t.device}</span>
            <strong>{device?.productName || (device ? productLabel(device.productId) : t.noDevice)}</strong>
          </div>
        </div>
        <Metric label={t.state} value={isConnected ? t.connected : t.ready} active={isConnected} />
        <Metric label={t.firmware} value={firmwareVersion || t.unknown} />
        <Metric label="RSSI" value={rssi === null ? t.unknown : `${rssi} dBm`} />
        <div className="device-actions">
          {authorizedDevices[0] && !isConnected && (
            <Button onClick={() => openAuthorized(authorizedDevices[0])} disabled={isBusy}>
              <Cable size={17} /> {t.open}
            </Button>
          )}
          <Button onClick={connect} disabled={!webHidSupported || isBusy}>
            <Power size={17} /> {t.connect}
          </Button>
        </div>
      </section>

      <div className="content-grid">
        <section className="panel config-panel">
          <SectionTitle icon={<SlidersHorizontal size={19} />} title={t.config} />
          <div className="section-block">
            <h2><Volume2 size={18} /> {t.feedback}</h2>
            <RangeControl
              label={t.hapticsGain}
              value={config.hapticsGain}
              min={1}
              max={2}
              step={0.05}
              digits={2}
              onChange={(value) => setConfig({ ...config, hapticsGain: value })}
            />
            {config.protocolVersion === 1 ? (
              <RangeControl
                label={t.speakerVolumeDb}
                value={config.speakerVolumeDb}
                min={-100}
                max={0}
                step={1}
                unit="dB"
                onChange={(value) => setConfig({ ...config, speakerVolumeDb: value })}
              />
            ) : (
              <>
                <RangeControl
                  label={t.speakerVolume}
                  value={config.speakerVolume}
                  min={0}
                  max={127}
                  step={1}
                  onChange={(value) => setConfig({ ...config, speakerVolume: value })}
                />
                <RangeControl
                  label={t.headsetVolume}
                  value={config.headsetVolume}
                  min={0}
                  max={127}
                  step={1}
                  onChange={(value) => setConfig({ ...config, headsetVolume: value })}
                />
                <ToggleControl
                  label={t.syncSpeakerHeadsetVolume}
                  checked={config.syncSpeakerHeadsetVolume}
                  onChange={(checked) => setConfig({ ...config, syncSpeakerHeadsetVolume: checked })}
                />
                <RangeControl
                  label={t.speakerGain}
                  value={config.speakerGain}
                  min={0}
                  max={7}
                  step={1}
                  onChange={(value) => setConfig({ ...config, speakerGain: value })}
                />
              </>
            )}
            <RangeControl
              label={t.audioBufferLength}
              value={config.audioBufferLength}
              min={16}
              max={128}
              step={1}
              onChange={(value) => setConfig({ ...config, audioBufferLength: Math.round(value) })}
            />
          </div>

          <div className="section-block">
            <h2><Zap size={18} /> {t.power}</h2>
            <RangeControl
              label={t.inactiveTime}
              value={config.inactiveTime}
              min={5}
              max={60}
              step={1}
              unit={t.inactiveUnit}
              onChange={(value) => setConfig({ ...config, inactiveTime: Math.round(value) })}
            />
            <ToggleControl
              label={t.disableInactiveDisconnect}
              checked={config.disableInactiveDisconnect}
              onChange={(checked) => setConfig({ ...config, disableInactiveDisconnect: checked })}
            />
            <ToggleControl
              label={t.disablePicoLed}
              checked={config.disablePicoLed}
              onChange={(checked) => setConfig({ ...config, disablePicoLed: checked })}
            />
          </div>

          <div className="section-block">
            <h2><Gauge size={18} /> {t.performance}</h2>
            <Segmented
              label={t.pollingRateMode}
              options={pollingLabels}
              value={config.pollingRateMode}
              onChange={(value) => setConfig({ ...config, pollingRateMode: value as 0 | 1 | 2 })}
            />
          </div>

          <div className="section-block">
            <h2><Cpu size={18} /> {t.compatibility}</h2>
            <Segmented
              label={t.controllerMode}
              options={controllerLabels}
              value={config.controllerMode}
              onChange={(value) => setConfig({ ...config, controllerMode: value as 0 | 1 | 2 })}
            />
          </div>
        </section>

        <aside className="panel side-panel">
          <SectionTitle icon={<Activity size={19} />} title={t.state} />
          <div className="action-grid">
            <Button onClick={() => withDevice('reading', readFromDevice)} disabled={!device || isBusy}>
              <RefreshCw size={17} /> {t.read}
            </Button>
            <Button
              intent="primary"
              onClick={() =>
                withDevice('applying', async (selected) => {
                  const bytes = await applyConfig(selected, config);
                  setRawConfigBytes(bytes);
                  setLastSavedConfig(config);
                  log('ok', t.applied);
                })
              }
              disabled={!device || isBusy}
            >
              <Check size={17} /> {t.apply}
            </Button>
            <Button
              onClick={() =>
                withDevice('saving', async (selected) => {
                  await saveConfig(selected);
                  log('ok', t.saved);
                })
              }
              disabled={!device || isBusy || isDirty}
            >
              <Save size={17} /> {t.save}
            </Button>
            <Button
              onClick={() =>
                withDevice('reconnecting', async (selected) => {
                  await reconnectUsb(selected);
                  log('info', t.reconnectSent);
                })
              }
              disabled={!device || isBusy}
            >
              <Power size={17} /> {t.reconnect}
            </Button>
            <Button
              onClick={() => {
                setConfig(resetConfig(config.protocolVersion));
                log('info', t.resetOk);
              }}
              disabled={isBusy}
            >
              <RotateCcw size={17} /> {t.reset}
            </Button>
          </div>
          <p className="operation-text">{operation ? operationLabel(operation, language) : isDirty ? 'Unsaved edits' : t.ready}</p>

          <SectionTitle icon={<TerminalSquare size={19} />} title={t.debug} />
          <div className="debug-grid">
            <DebugRow label={t.protocol} value={`v${config.protocolVersion} · ${config.protocolVersion === 1 ? t.legacyMode : t.devMode}`} />
            <DebugRow label={t.byteLength} value={`${CONFIG_SIZE}`} />
            <DebugRow label={t.reportIds} value="F6 / F7 / F8 / F9" />
            <DebugRow label={t.rawConfig} value={rawConfigBytes ? bytesToHex(rawConfigBytes) : '-'} mono />
            <DebugRow label={t.encodedConfig} value={outgoingBytes ? bytesToHex(outgoingBytes) : '-'} mono />
          </div>

          <div className="log-box" aria-label={t.logs}>
            {logs.length === 0 ? (
              <div className="log-empty">{t.logs}</div>
            ) : (
              logs.map((entry, index) => (
                <div className={`log-line ${entry.level}`} key={`${entry.at}-${index}`}>
                  <span>{entry.at}</span>
                  <strong>{entry.level}</strong>
                  <p>{entry.message}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function readTheme(): ThemeMode {
  const value = localStorage.getItem('ds5bridge-theme');
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function nextTheme(theme: ThemeMode): ThemeMode {
  if (theme === 'system') {
    return 'light';
  }
  if (theme === 'light') {
    return 'dark';
  }
  return 'system';
}

function operationLabel(operation: Exclude<Operation, null>, language: Language) {
  const labels = {
    zh: {
      connecting: '正在连接',
      reading: '正在读取',
      applying: '正在应用',
      saving: '正在保存',
      reconnecting: '正在重连',
    },
    en: {
      connecting: 'Connecting',
      reading: 'Reading',
      applying: 'Applying',
      saving: 'Saving',
      reconnecting: 'Reconnecting',
    },
  };
  return labels[language][operation];
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-button" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

function Button({
  children,
  disabled,
  intent = 'secondary',
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  intent?: 'primary' | 'secondary';
  onClick: () => void;
}) {
  return (
    <button className={`button ${intent}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={`metric ${active ? 'active' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
      <span>{label}</span>
      <div className="range-line">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input
          className="number-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(digits))}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="control">
      <span>{label}</span>
      <div className="segments">
        {options.map((option, index) => (
          <button className={index === value ? 'selected' : ''} key={option} onClick={() => onChange(index)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function DebugRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="debug-row">
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
