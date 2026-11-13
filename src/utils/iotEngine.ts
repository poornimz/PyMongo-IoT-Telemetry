export interface SensorLog {
  id: string;
  device_id: string;
  temperature: number;
  vibration: number;
  timestamp: string;
}

export type AnomalyReason =
  | 'nominal'
  | 'peak_thermal_spike'
  | 'hourly_average_exceeded'
  | 'sustained_and_peak_overheat';

export interface HourlyBucket {
  device_id: string;
  hour: string;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  avg_vibration: number;
  max_vibration: number;
  reading_count: number;
  spike_count: number;
  is_thermal_anomaly: boolean;
  anomaly_reason: AnomalyReason;
}

export interface PipelineConfig {
  avgThreshold: number;
  peakThreshold: number;
  anomalyProbability: number;
  batchSize: number;
  lookbackHours: number;
  intervalMs: number;
}

export interface DeviceProfile {
  device_id: string;
  label: string;
  base_temp: number;
  base_vib: number;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  { device_id: 'turbine-01', label: 'Turbine 01', base_temp: 64.0, base_vib: 2.1 },
  { device_id: 'turbine-02', label: 'Turbine 02', base_temp: 68.5, base_vib: 2.4 },
  { device_id: 'compressor-01', label: 'Compressor 01', base_temp: 71.0, base_vib: 3.2 },
  { device_id: 'chiller-04', label: 'Chiller 04', base_temp: 52.0, base_vib: 1.4 },
];

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Box-Muller transform for realistic Gaussian sensor noise
function gaussianNoise(mean = 0, stdDev = 1): number {
  const u1 = Math.max(1e-7, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

export function createReading(
  index: number,
  timestamp: Date,
  anomalyProbability: number,
  forceSpike = false,
  targetDeviceId?: string,
): SensorLog {
  const profile = targetDeviceId
    ? DEVICE_PROFILES.find((d) => d.device_id === targetDeviceId) ??
      DEVICE_PROFILES[index % DEVICE_PROFILES.length]
    : DEVICE_PROFILES[index % DEVICE_PROFILES.length];

  const phase = (index / 24) * Math.PI;
  const diurnal = 3.5 * Math.sin(phase);
  let temperature = profile.base_temp + diurnal + gaussianNoise(0, 1.8);
  let vibration = Math.max(0.1, profile.base_vib + gaussianNoise(0, 0.35));

  if (forceSpike || Math.random() < anomalyProbability) {
    temperature += 16.0 + Math.random() * 12.0;
    vibration += 2.5 + Math.random() * 2.7;
  }

  return {
    id: `${timestamp.getTime()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    device_id: profile.device_id,
    temperature: roundTo(temperature, 2),
    vibration: roundTo(vibration, 3),
    timestamp: timestamp.toISOString(),
  };
}

export function generateBackfillStream(
  totalEvents = 144,
  backfillHours = 4,
  anomalyProbability = 0.08,
): SensorLog[] {
  const now = Date.now();
  const startMs = now - backfillHours * 3600 * 1000;
  const stepMs = (backfillHours * 3600 * 1000) / Math.max(totalEvents, 1);

  const logs: SensorLog[] = [];
  for (let i = 0; i < totalEvents; i++) {
    const ts = new Date(startMs + stepMs * i);
    // Guarantee at least two realistic thermal excursions across the backfill window
    const injectSampleAnomaly = i === 62 || i === 110;
    logs.push(createReading(i, ts, anomalyProbability, injectSampleAnomaly));
  }
  return logs;
}

function truncateToUtcHour(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Mirrors the exact MongoDB aggregation pipeline:
 * $match (lookbackHours) -> $group (device_id, $dateTrunc hour) -> $project -> $sort
 */
export function aggregateHourlyBuckets(
  logs: SensorLog[],
  avgThreshold: number,
  peakThreshold: number,
  lookbackHours = 24,
): HourlyBucket[] {
  const cutoffMs = Date.now() - lookbackHours * 3600 * 1000;

  interface Acc {
    device_id: string;
    hour: string;
    tempSum: number;
    minTemp: number;
    maxTemp: number;
    vibSum: number;
    maxVib: number;
    count: number;
    spikeCount: number;
  }

  const groups = new Map<string, Acc>();

  for (const log of logs) {
    const tsMs = Date.parse(log.timestamp);
    if (Number.isNaN(tsMs) || tsMs < cutoffMs) continue;

    const hour = truncateToUtcHour(log.timestamp);
    const key = `${log.device_id}__${hour}`;
    const existing = groups.get(key);

    const isSpike = log.temperature >= peakThreshold ? 1 : 0;

    if (!existing) {
      groups.set(key, {
        device_id: log.device_id,
        hour,
        tempSum: log.temperature,
        minTemp: log.temperature,
        maxTemp: log.temperature,
        vibSum: log.vibration,
        maxVib: log.vibration,
        count: 1,
        spikeCount: isSpike,
      });
    } else {
      existing.tempSum += log.temperature;
      existing.minTemp = Math.min(existing.minTemp, log.temperature);
      existing.maxTemp = Math.max(existing.maxTemp, log.temperature);
      existing.vibSum += log.vibration;
      existing.maxVib = Math.max(existing.maxVib, log.vibration);
      existing.count += 1;
      existing.spikeCount += isSpike;
    }
  }

  const buckets: HourlyBucket[] = [];
  for (const acc of groups.values()) {
    const avgTemp = roundTo(acc.tempSum / acc.count, 2);
    const minTemp = roundTo(acc.minTemp, 2);
    const maxTemp = roundTo(acc.maxTemp, 2);
    const avgVib = roundTo(acc.vibSum / acc.count, 3);
    const maxVib = roundTo(acc.maxVib, 3);

    const avgExceeded = avgTemp >= avgThreshold;
    const peakExceeded = maxTemp >= peakThreshold;

    let anomalyReason: AnomalyReason = 'nominal';
    if (avgExceeded && peakExceeded) {
      anomalyReason = 'sustained_and_peak_overheat';
    } else if (avgExceeded) {
      anomalyReason = 'hourly_average_exceeded';
    } else if (peakExceeded) {
      anomalyReason = 'peak_thermal_spike';
    }

    buckets.push({
      device_id: acc.device_id,
      hour: acc.hour,
      avg_temperature: avgTemp,
      min_temperature: minTemp,
      max_temperature: maxTemp,
      avg_vibration: avgVib,
      max_vibration: maxVib,
      reading_count: acc.count,
      spike_count: acc.spikeCount,
      is_thermal_anomaly: avgExceeded || peakExceeded,
      anomaly_reason: anomalyReason,
    });
  }

  buckets.sort((a, b) => {
    if (a.hour !== b.hour) return b.hour.localeCompare(a.hour);
    if (a.is_thermal_anomaly !== b.is_thermal_anomaly) {
      return a.is_thermal_anomaly ? -1 : 1;
    }
    return a.device_id.localeCompare(b.device_id);
  });

  return buckets;
}

export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19);
}

export function formatUtcHour(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}
