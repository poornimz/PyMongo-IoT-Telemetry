import React from 'react';
import type { SensorLog } from '../utils/iotEngine';

interface StreamingLogFeedProps {
  logs: SensorLog[];
  peakThreshold: number;
  avgThreshold: number;
}

export const StreamingLogFeed: React.FC<StreamingLogFeedProps> = ({
  logs,
  peakThreshold,
  avgThreshold,
}) => {
  const latestLogs = logs.slice(-18).reverse();

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Streaming JSON IoT Payload Inspector
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Most recent {latestLogs.length} documents formatted for MongoDB insert_many
          </p>
        </div>
      </div>

      {latestLogs.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          No JSON documents emitted yet.
        </div>
      ) : (
        <div className="mt-3 divide-y divide-slate-100 max-h-[340px] overflow-y-auto font-mono text-xs tabular-nums">
          {latestLogs.map((log) => {
            const isPeak = log.temperature >= peakThreshold;
            const isElevated = !isPeak && log.temperature >= avgThreshold;
            const payload = JSON.stringify({
              device_id: log.device_id,
              temperature: log.temperature,
              vibration: log.vibration,
              timestamp: log.timestamp,
            });

            return (
              <div
                key={log.id}
                className={`py-2 px-2 flex items-center justify-between gap-4 ${
                  isPeak ? 'bg-rose-50/50' : ''
                }`}
              >
                <code className="text-slate-700 truncate">{payload}</code>
                <span
                  className={`shrink-0 whitespace-nowrap ${
                    isPeak
                      ? 'text-rose-700 font-semibold'
                      : isElevated
                        ? 'text-amber-700 font-medium'
                        : 'text-slate-500'
                  }`}
                >
                  {isPeak ? '▲ PEAK SPIKE' : isElevated ? '▲ ELEVATED' : 'NOMINAL'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
