import React, { useMemo, useState } from 'react';
import type { AnomalyReason, HourlyBucket } from '../utils/iotEngine';
import { formatUtcHour } from '../utils/iotEngine';

interface HourlyAggregationTableProps {
  buckets: HourlyBucket[];
  avgThreshold: number;
  peakThreshold: number;
}

const REASON_LABELS: Record<AnomalyReason, string> = {
  nominal: '● Nominal',
  peak_thermal_spike: '▲ Peak Spike',
  hourly_average_exceeded: '▲ Avg Exceeded',
  sustained_and_peak_overheat: '✖ Sustained + Peak',
};

export const HourlyAggregationTable: React.FC<HourlyAggregationTableProps> = ({
  buckets,
  avgThreshold,
  peakThreshold,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'anomalies'>('all');

  const visibleBuckets = useMemo(() => {
    if (statusFilter === 'anomalies') {
      return buckets.filter((b) => b.is_thermal_anomaly);
    }
    return buckets;
  }, [buckets, statusFilter]);

  const anomalyCount = buckets.filter((b) => b.is_thermal_anomaly).length;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Hourly Aggregation Output ($dateTrunc + Thermal Anomaly Flags)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {buckets.length} hourly device buckets
            <span aria-hidden="true" className="mx-1.5">·</span>
            {anomalyCount} flagged
            <span aria-hidden="true" className="mx-1.5">·</span>
            Rules: avg ≥ {avgThreshold.toFixed(1)} °C or peak ≥ {peakThreshold.toFixed(1)} °C
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Filter hourly buckets">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Buckets ({buckets.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('anomalies')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === 'anomalies'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Flagged Only ({anomalyCount})
          </button>
        </div>
      </div>

      {visibleBuckets.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          {statusFilter === 'anomalies'
            ? 'No thermal anomalies detected under the current thresholds.'
            : 'No aggregated hourly buckets yet. Start the stream to populate telemetry.'}
        </div>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 pr-4 whitespace-nowrap">Hour Bucket</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Device</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Avg Temp</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Min / Max</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Avg Vib</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Samples</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Spikes</th>
                <th className="py-2.5 pl-3 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {visibleBuckets.map((row) => {
                const statusColor =
                  row.anomaly_reason === 'sustained_and_peak_overheat'
                    ? 'text-rose-700 font-semibold'
                    : row.is_thermal_anomaly
                      ? 'text-amber-700 font-semibold'
                      : 'text-emerald-700 font-medium';

                return (
                  <tr
                    key={`${row.device_id}-${row.hour}`}
                    className={`hover:bg-slate-50 transition-colors ${
                      row.is_thermal_anomaly ? 'bg-rose-50/35' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {formatUtcHour(row.hour)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-900 font-medium whitespace-nowrap">
                      {row.device_id}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        row.avg_temperature >= avgThreshold
                          ? 'text-rose-700 font-semibold'
                          : 'text-slate-900'
                      }`}
                    >
                      {row.avg_temperature.toFixed(2)} °C
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {row.min_temperature.toFixed(1)} /{' '}
                      <span
                        className={
                          row.max_temperature >= peakThreshold
                            ? 'text-rose-700 font-semibold'
                            : 'text-slate-800'
                        }
                      >
                        {row.max_temperature.toFixed(1)}
                      </span>{' '}
                      °C
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {row.avg_vibration.toFixed(3)} mm/s
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {row.reading_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {row.spike_count}
                    </td>
                    <td className={`py-2.5 pl-3 whitespace-nowrap ${statusColor}`}>
                      {REASON_LABELS[row.anomaly_reason]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
