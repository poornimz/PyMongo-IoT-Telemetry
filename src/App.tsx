import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Flame, Pause, Play, RotateCcw } from 'lucide-react';
import { HourlyAggregationTable } from './components/HourlyAggregationTable';
import { PythonScriptPanel, triggerTextDownload } from './components/PythonScriptPanel';
import { StreamingLogFeed } from './components/StreamingLogFeed';
import { TelemetryChart } from './components/TelemetryChart';
import { buildPythonScript } from './data/pythonSource';
import {
  DEVICE_PROFILES,
  type PipelineConfig,
  type SensorLog,
  aggregateHourlyBuckets,
  createReading,
  generateBackfillStream,
} from './utils/iotEngine';

const INITIAL_CONFIG: PipelineConfig = {
  avgThreshold: 75.0,
  peakThreshold: 85.0,
  anomalyProbability: 0.08,
  batchSize: 25,
  lookbackHours: 24,
  intervalMs: 800,
};

export default function App() {
  const [config, setConfig] = useState<PipelineConfig>(INITIAL_CONFIG);
  const [logs, setLogs] = useState<SensorLog[]>(() =>
    generateBackfillStream(144, 4, INITIAL_CONFIG.anomalyProbability),
  );
  const [isStreaming, setIsStreaming] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [codeTab, setCodeTab] = useState<'python' | 'pipeline'>('python');
  const stepRef = useRef<number>(144);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = window.setInterval(() => {
      const nextIdx = stepRef.current++;
      const target = selectedDevice === 'all' ? undefined : selectedDevice;
      const nextDoc = createReading(
        nextIdx,
        new Date(),
        config.anomalyProbability,
        false,
        target,
      );
      setLogs((prev) => {
        const next = [...prev, nextDoc];
        return next.length > 480 ? next.slice(next.length - 480) : next;
      });
    }, config.intervalMs);

    return () => window.clearInterval(timer);
  }, [isStreaming, config.intervalMs, config.anomalyProbability, selectedDevice]);

  const filteredLogs = useMemo(() => {
    if (selectedDevice === 'all') return logs;
    return logs.filter((l) => l.device_id === selectedDevice);
  }, [logs, selectedDevice]);

  const hourlyBuckets = useMemo(
    () =>
      aggregateHourlyBuckets(
        filteredLogs,
        config.avgThreshold,
        config.peakThreshold,
        config.lookbackHours,
      ),
    [filteredLogs, config.avgThreshold, config.peakThreshold, config.lookbackHours],
  );

  const summaryStats = useMemo(() => {
    let maxTemp = 0;
    for (const l of filteredLogs) {
      if (l.temperature > maxTemp) maxTemp = l.temperature;
    }
    const anomalyBuckets = hourlyBuckets.filter((b) => b.is_thermal_anomaly).length;
    return {
      totalReadings: filteredLogs.length,
      totalBuckets: hourlyBuckets.length,
      anomalyBuckets,
      maxTemp,
    };
  }, [filteredLogs, hourlyBuckets]);

  const handleInjectSpike = () => {
    const nextIdx = stepRef.current++;
    const target = selectedDevice === 'all' ? 'turbine-02' : selectedDevice;
    const spikeDoc = createReading(nextIdx, new Date(), 1.0, true, target);
    setLogs((prev) => {
      const next = [...prev, spikeDoc];
      return next.length > 480 ? next.slice(next.length - 480) : next;
    });
  };

  const handleReset = () => {
    stepRef.current = 144;
    setLogs(generateBackfillStream(144, 4, config.anomalyProbability));
  };

  const handleDownloadPython = () => {
    triggerTextDownload('iot_telemetry_pipeline.py', buildPythonScript(config));
  };

  const scrollToSection = (id: string, tab?: 'python' | 'pipeline') => {
    if (tab) setCodeTab(tab);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#telemetry"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('telemetry');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            ThermalStream
          </a>

          <nav
            aria-label="Primary sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#telemetry"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('telemetry');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Telemetry Chart
            </a>
            <a
              href="#aggregation"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('aggregation');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Hourly Aggregation
            </a>
            <a
              href="#script"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('script', 'pipeline');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pipeline Spec
            </a>
            <a
              href="#script"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('script', 'python');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Python Script
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleDownloadPython}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download .py
            </button>
          </div>
        </div>
      </header>

      {/* Main Asymmetric Split Console */}
      <main className="max-w-[1440px] mx-auto px-6 py-6 flex flex-col lg:flex-row items-start gap-6">
        {/* Left Control & Parameter Column */}
        <aside className="w-full lg:w-80 shrink-0 bg-white border border-slate-200 rounded-lg p-5 space-y-6 lg:sticky lg:top-22">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-sm font-semibold text-slate-900">
                PyMongo Stream Controls
              </h1>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isStreaming ? 'text-emerald-700 font-medium' : 'text-slate-500'
                }`}
              >
                {isStreaming ? '● Streaming' : '● Paused'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Simulates JSON IoT payloads and evaluates MongoDB hourly buckets in real time.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsStreaming((prev) => !prev)}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  isStreaming
                    ? 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                    : 'bg-sky-600 text-white hover:bg-sky-700'
                }`}
              >
                {isStreaming ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>

            <button
              type="button"
              onClick={handleInjectSpike}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors whitespace-nowrap"
            >
              <Flame className="w-3.5 h-3.5" />
              Inject Thermal Spike
            </button>
          </div>

          <div className="pt-5 border-t border-slate-100 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Aggregation Thresholds
            </h2>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="avg-threshold" className="font-medium text-slate-700">
                  Hourly Avg Limit
                </label>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {config.avgThreshold.toFixed(1)} °C
                </span>
              </div>
              <input
                id="avg-threshold"
                type="range"
                min={55}
                max={90}
                step={0.5}
                value={config.avgThreshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setConfig((prev) => ({
                    ...prev,
                    avgThreshold: val,
                    peakThreshold: Math.max(prev.peakThreshold, val + 4),
                  }));
                }}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="peak-threshold" className="font-medium text-slate-700">
                  Peak Spike Limit
                </label>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {config.peakThreshold.toFixed(1)} °C
                </span>
              </div>
              <input
                id="peak-threshold"
                type="range"
                min={65}
                max={105}
                step={0.5}
                value={config.peakThreshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setConfig((prev) => ({
                    ...prev,
                    peakThreshold: val,
                    avgThreshold: Math.min(prev.avgThreshold, val - 4),
                  }));
                }}
                className="w-full accent-rose-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="anomaly-prob" className="font-medium text-slate-700">
                  Spike Probability
                </label>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {Math.round(config.anomalyProbability * 100)}%
                </span>
              </div>
              <input
                id="anomaly-prob"
                type="range"
                min={0}
                max={30}
                step={1}
                value={Math.round(config.anomalyProbability * 100)}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    anomalyProbability: parseInt(e.target.value, 10) / 100,
                  }))
                }
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label
                  htmlFor="interval-ms"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Stream Cadence
                </label>
                <select
                  id="interval-ms"
                  value={config.intervalMs}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      intervalMs: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                >
                  <option value={300}>300 ms</option>
                  <option value={800}>800 ms</option>
                  <option value={1500}>1500 ms</option>
                  <option value={3000}>3000 ms</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="batch-size"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Mongo Batch
                </label>
                <select
                  id="batch-size"
                  value={config.batchSize}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      batchSize: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-900"
                >
                  <option value={10}>10 docs</option>
                  <option value={25}>25 docs</option>
                  <option value={50}>50 docs</option>
                  <option value={100}>100 docs</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-5 border-t border-slate-100">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
              Device Scope
            </h2>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setSelectedDevice('all')}
                className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-between ${
                  selectedDevice === 'all'
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>All Sensor Units</span>
                <span className="font-mono tabular-nums opacity-80">4</span>
              </button>
              {DEVICE_PROFILES.map((dev) => (
                <button
                  key={dev.device_id}
                  type="button"
                  onClick={() => setSelectedDevice(dev.device_id)}
                  className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors flex items-center justify-between ${
                    selectedDevice === dev.device_id
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="font-mono">{dev.device_id}</span>
                  <span className="font-mono tabular-nums opacity-75">
                    ~{dev.base_temp}°C
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Viewport Stage */}
        <div className="flex-1 min-w-0 space-y-6 w-full">
          {/* 4-Column Metric Strip */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Buffered IoT Logs
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {summaryStats.totalReadings}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5 uppercase">
                  JSON docs
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Hourly Buckets
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {summaryStats.totalBuckets}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5 uppercase">
                  $dateTrunc UTC
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Thermal Anomalies
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span
                  className={`text-2xl font-bold font-mono tabular-nums ${
                    summaryStats.anomalyBuckets > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {summaryStats.anomalyBuckets}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5 uppercase">
                  flagged buckets
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Observed Peak Temp
              </div>
              <div className="mt-1.5 flex items-baseline">
                <span
                  className={`text-2xl font-bold font-mono tabular-nums ${
                    summaryStats.maxTemp >= config.peakThreshold
                      ? 'text-rose-700'
                      : 'text-slate-900'
                  }`}
                >
                  {summaryStats.maxTemp.toFixed(2)}
                </span>
                <span className="text-xs font-mono text-slate-400 ml-1.5">
                  °C
                </span>
              </div>
            </div>
          </div>

          <div id="telemetry" className="scroll-mt-22">
            <TelemetryChart
              logs={logs}
              selectedDevice={selectedDevice}
              avgThreshold={config.avgThreshold}
              peakThreshold={config.peakThreshold}
            />
          </div>

          <div id="aggregation" className="scroll-mt-22">
            <HourlyAggregationTable
              buckets={hourlyBuckets}
              avgThreshold={config.avgThreshold}
              peakThreshold={config.peakThreshold}
            />
          </div>

          <div id="script" className="scroll-mt-22">
            <PythonScriptPanel
              config={config}
              activeTab={codeTab}
              onTabChange={setCodeTab}
            />
          </div>

          <div id="logs" className="scroll-mt-22">
            <StreamingLogFeed
              logs={filteredLogs}
              peakThreshold={config.peakThreshold}
              avgThreshold={config.avgThreshold}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
