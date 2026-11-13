import React, { useMemo, useState } from 'react';
import type { SensorLog } from '../utils/iotEngine';
import { formatUtcTime } from '../utils/iotEngine';

interface TelemetryChartProps {
  logs: SensorLog[];
  selectedDevice: string;
  avgThreshold: number;
  peakThreshold: number;
}

export const TelemetryChart: React.FC<TelemetryChartProps> = ({
  logs,
  selectedDevice,
  avgThreshold,
  peakThreshold,
}) => {
  const [showVibration, setShowVibration] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(() => {
    const filtered =
      selectedDevice === 'all'
        ? logs
        : logs.filter((item) => item.device_id === selectedDevice);
    return filtered.slice(-80);
  }, [logs, selectedDevice]);

  const width = 880;
  const height = 280;
  const padLeft = 48;
  const padRight = 52;
  const padTop = 20;
  const padBottom = 34;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const { minTemp, maxTemp, maxVib } = useMemo(() => {
    if (series.length === 0) {
      return { minTemp: 40, maxTemp: 100, maxVib: 10 };
    }
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMax = 4;
    for (const s of series) {
      if (s.temperature < tMin) tMin = s.temperature;
      if (s.temperature > tMax) tMax = s.temperature;
      if (s.vibration > vMax) vMax = s.vibration;
    }
    const low = Math.floor(Math.min(tMin, avgThreshold - 10, 42) / 5) * 5;
    const high = Math.ceil(Math.max(tMax, peakThreshold + 6, 95) / 5) * 5;
    return {
      minTemp: low,
      maxTemp: Math.max(high, low + 20),
      maxVib: Math.ceil(vMax + 1),
    };
  }, [series, avgThreshold, peakThreshold]);

  const xForIndex = (idx: number) => {
    if (series.length <= 1) return padLeft + innerW / 2;
    return padLeft + (idx / (series.length - 1)) * innerW;
  };

  const yForTemp = (temp: number) => {
    const ratio = (temp - minTemp) / Math.max(1, maxTemp - minTemp);
    return padTop + innerH - ratio * innerH;
  };

  const yForVib = (vib: number) => {
    const ratio = vib / Math.max(1, maxVib);
    return padTop + innerH - ratio * innerH;
  };

  const tempPath = useMemo(() => {
    if (series.length === 0) return '';
    return series
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(i).toFixed(1)} ${yForTemp(pt.temperature).toFixed(1)}`)
      .join(' ');
  }, [series, minTemp, maxTemp]);

  const vibPath = useMemo(() => {
    if (series.length === 0) return '';
    return series
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(i).toFixed(1)} ${yForVib(pt.vibration).toFixed(1)}`)
      .join(' ');
  }, [series, maxVib]);

  const tempTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(Math.round(minTemp + ((maxTemp - minTemp) * i) / steps));
    }
    return out;
  }, [minTemp, maxTemp]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const clamped = Math.max(padLeft, Math.min(width - padRight, relX));
    const idx = Math.round(((clamped - padLeft) / innerW) * (series.length - 1));
    setHoverIndex(Math.max(0, Math.min(series.length - 1, idx)));
  };

  const activePoint = hoverIndex !== null ? series[hoverIndex] : null;
  const avgY = yForTemp(avgThreshold);
  const peakY = yForTemp(peakThreshold);

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Temperature &amp; Vibration Telemetry Stream
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Window: latest {series.length} JSON events
            <span aria-hidden="true" className="mx-1.5">·</span>
            Scope: {selectedDevice === 'all' ? 'All 4 sensor units' : selectedDevice}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-sky-600 inline-block" />
              Temp (°C)
            </span>
            {showVibration && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                Vib (mm/s)
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-amber-600 inline-block" />
              Avg {avgThreshold}°C
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-rose-600 inline-block" />
              Peak {peakThreshold}°C
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowVibration((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {showVibration ? 'Hide Vibration' : 'Show Vibration'}
          </button>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="h-[280px] flex items-center justify-center text-sm text-slate-500">
          No sensor readings available for the selected device filter.
        </div>
      ) : (
        <div className="relative mt-4">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto cursor-crosshair select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
            role="img"
            aria-label="IoT sensor temperature and vibration time series chart"
          >
            {/* Horizontal Grid & Temp Y-Axis */}
            {tempTicks.map((tick) => {
              const y = yForTemp(tick);
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="#F1F5F9"
                    strokeWidth={1}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    {tick}°
                  </text>
                </g>
              );
            })}

            {/* Right Y-Axis labels for vibration */}
            {showVibration &&
              [0, Math.round(maxVib / 2), maxVib].map((vTick) => {
                const y = yForVib(vTick);
                return (
                  <text
                    key={vTick}
                    x={width - padRight + 8}
                    y={y + 3}
                    textAnchor="start"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    {vTick} mm/s
                  </text>
                );
              })}

            {/* Threshold Reference Lines */}
            {avgY >= padTop && avgY <= padTop + innerH && (
              <line
                x1={padLeft}
                y1={avgY}
                x2={width - padRight}
                y2={avgY}
                stroke="#D97706"
                strokeWidth={1.25}
                strokeDasharray="4 4"
              />
            )}
            {peakY >= padTop && peakY <= padTop + innerH && (
              <line
                x1={padLeft}
                y1={peakY}
                x2={width - padRight}
                y2={peakY}
                stroke="#DC2626"
                strokeWidth={1.25}
                strokeDasharray="4 4"
              />
            )}

            {/* Vibration secondary trace */}
            {showVibration && (
              <path
                d={vibPath}
                fill="none"
                stroke="#94A3B8"
                strokeWidth={1.35}
                strokeLinejoin="round"
              />
            )}

            {/* Primary Temperature trace */}
            <path
              d={tempPath}
              fill="none"
              stroke="#0284C7"
              strokeWidth={2}
              strokeLinejoin="round"
            />

            {/* Highlight spike markers */}
            {series.map((pt, idx) => {
              if (pt.temperature < peakThreshold) return null;
              return (
                <circle
                  key={pt.id}
                  cx={xForIndex(idx)}
                  cy={yForTemp(pt.temperature)}
                  r={3.5}
                  className="fill-rose-600 stroke-white"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* X-Axis Timestamps */}
            {[0, Math.floor((series.length - 1) / 2), series.length - 1]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((idx) => (
                <text
                  key={idx}
                  x={xForIndex(idx)}
                  y={height - 10}
                  textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
                  className="fill-slate-400 text-[10px] font-mono tabular-nums"
                >
                  {formatUtcTime(series[idx].timestamp)} UTC
                </text>
              ))}

            {/* Interactive Crosshair */}
            {hoverIndex !== null && activePoint && (
              <g>
                <line
                  x1={xForIndex(hoverIndex)}
                  y1={padTop}
                  x2={xForIndex(hoverIndex)}
                  y2={padTop + innerH}
                  stroke="#0F172A"
                  strokeWidth={1}
                  strokeOpacity={0.25}
                />
                <circle
                  cx={xForIndex(hoverIndex)}
                  cy={yForTemp(activePoint.temperature)}
                  r={4.5}
                  fill={activePoint.temperature >= peakThreshold ? '#DC2626' : '#0284C7'}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>

          {/* Compact Monospace Crosshair HUD */}
          {activePoint && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-4 px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono tabular-nums text-slate-700">
              <span>
                <strong className="text-slate-900">{activePoint.device_id}</strong>
                <span aria-hidden="true" className="mx-2 text-slate-400">·</span>
                {activePoint.timestamp}
              </span>
              <span>
                Temp:{' '}
                <strong
                  className={
                    activePoint.temperature >= peakThreshold
                      ? 'text-rose-600'
                      : activePoint.temperature >= avgThreshold
                        ? 'text-amber-600'
                        : 'text-slate-900'
                  }
                >
                  {activePoint.temperature.toFixed(2)} °C
                </strong>
                <span aria-hidden="true" className="mx-2 text-slate-400">·</span>
                Vibration: <strong className="text-slate-900">{activePoint.vibration.toFixed(3)} mm/s</strong>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
