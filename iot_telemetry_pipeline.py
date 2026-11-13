#!/usr/bin/env python3
"""
IoT Sensor Telemetry Streamer & MongoDB Thermal Anomaly Aggregation Pipeline.

Simulates streaming JSON IoT sensor logs (device_id, temperature, vibration, timestamp),
persists them into MongoDB using pymongo, and runs a MongoDB aggregation pipeline to
compute hourly averages and flag thermal anomalies.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.errors import CollectionInvalid, PyMongoError

DEFAULT_DEVICES = [
    {"device_id": "turbine-01", "base_temp": 64.0, "base_vib": 2.1},
    {"device_id": "turbine-02", "base_temp": 68.5, "base_vib": 2.4},
    {"device_id": "compressor-01", "base_temp": 71.0, "base_vib": 3.2},
    {"device_id": "chiller-04", "base_temp": 52.0, "base_vib": 1.4},
]


def ensure_telemetry_collection(db: Any, collection_name: str) -> Collection:
    """Ensure a time-series (or indexed standard) MongoDB collection exists."""
    existing = db.list_collection_names()
    if collection_name not in existing:
        try:
            db.create_collection(
                collection_name,
                timeseries={
                    "timeField": "timestamp",
                    "metaField": "device_id",
                    "granularity": "seconds",
                },
            )
            print(f"[mongo] Created time-series collection '{collection_name}'")
        except CollectionInvalid:
            pass
        except PyMongoError as exc:
            print(
                f"[mongo] Time-series creation skipped ({exc}); using standard collection.",
                file=sys.stderr,
            )

    collection = db[collection_name]
    collection.create_index([("device_id", ASCENDING), ("timestamp", DESCENDING)])
    return collection


def simulate_iot_stream(
    total_events: int | None = 200,
    interval_seconds: float = 0.05,
    anomaly_probability: float = 0.08,
    backfill_hours: int = 4,
    seed: int | None = None,
) -> Iterator[dict[str, Any]]:
    """
    Yield simulated JSON-serializable IoT telemetry payloads.

    Each document includes:
      - device_id (str): Sensor unit identifier
      - temperature (float): Degrees Celsius
      - vibration (float): RMS vibration in mm/s
      - timestamp (datetime): UTC timestamp
    """
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=backfill_hours)
    step = (
        timedelta(hours=backfill_hours) / max(total_events, 1)
        if total_events is not None and backfill_hours > 0
        else timedelta(seconds=1)
    )

    emitted = 0
    while total_events is None or emitted < total_events:
        device = DEFAULT_DEVICES[emitted % len(DEFAULT_DEVICES)]
        ts = (
            start_time + step * emitted
            if total_events is not None and backfill_hours > 0
            else datetime.now(timezone.utc)
        )

        # Smooth diurnal drift + Gaussian sensor noise
        phase = (emitted / 24.0) * math.pi
        diurnal = 3.5 * math.sin(phase)
        temp = device["base_temp"] + diurnal + rng.gauss(0.0, 1.8)
        vibration = max(0.1, device["base_vib"] + rng.gauss(0.0, 0.35))

        # Occasional thermal + vibration spike event
        if rng.random() < anomaly_probability:
            temp += rng.uniform(16.0, 28.0)
            vibration += rng.uniform(2.5, 5.2)

        yield {
            "device_id": device["device_id"],
            "temperature": round(temp, 2),
            "vibration": round(vibration, 3),
            "timestamp": ts,
        }

        emitted += 1
        if interval_seconds > 0 and (total_events is None or emitted < total_events):
            time.sleep(interval_seconds)


def build_hourly_aggregation_pipeline(
    lookback_hours: int = 24,
    avg_temp_threshold: float = 75.0,
    peak_temp_threshold: float = 85.0,
) -> list[dict[str, Any]]:
    """
    Build a MongoDB aggregation pipeline to compute hourly device averages
    and flag thermal anomalies.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

    return [
        {"$match": {"timestamp": {"$gte": cutoff}}},
        {
            "$group": {
                "_id": {
                    "device_id": "$device_id",
                    "hour": {
                        "$dateTrunc": {
                            "date": "$timestamp",
                            "unit": "hour",
                            "timezone": "UTC",
                        }
                    },
                },
                "avg_temperature": {"$avg": "$temperature"},
                "min_temperature": {"$min": "$temperature"},
                "max_temperature": {"$max": "$temperature"},
                "avg_vibration": {"$avg": "$vibration"},
                "max_vibration": {"$max": "$vibration"},
                "reading_count": {"$sum": 1},
                "spike_count": {
                    "$sum": {
                        "$cond": [
                            {"$gte": ["$temperature", peak_temp_threshold]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
        {
            "$project": {
                "_id": 0,
                "device_id": "$_id.device_id",
                "hour": "$_id.hour",
                "avg_temperature": {"$round": ["$avg_temperature", 2]},
                "min_temperature": {"$round": ["$min_temperature", 2]},
                "max_temperature": {"$round": ["$max_temperature", 2]},
                "avg_vibration": {"$round": ["$avg_vibration", 3]},
                "max_vibration": {"$round": ["$max_vibration", 3]},
                "reading_count": 1,
                "spike_count": 1,
                "is_thermal_anomaly": {
                    "$or": [
                        {"$gte": ["$avg_temperature", avg_temp_threshold]},
                        {"$gte": ["$max_temperature", peak_temp_threshold]},
                    ]
                },
                "anomaly_reason": {
                    "$switch": {
                        "branches": [
                            {
                                "case": {
                                    "$and": [
                                        {"$gte": ["$avg_temperature", avg_temp_threshold]},
                                        {"$gte": ["$max_temperature", peak_temp_threshold]},
                                    ]
                                },
                                "then": "sustained_and_peak_overheat",
                            },
                            {
                                "case": {"$gte": ["$avg_temperature", avg_temp_threshold]},
                                "then": "hourly_average_exceeded",
                            },
                            {
                                "case": {"$gte": ["$max_temperature", peak_temp_threshold]},
                                "then": "peak_thermal_spike",
                            },
                        ],
                        "default": "nominal",
                    }
                },
            }
        },
        {"$sort": {"hour": -1, "is_thermal_anomaly": -1, "device_id": 1}},
    ]


def stream_to_mongodb(
    collection: Collection,
    events: Iterator[dict[str, Any]],
    batch_size: int = 25,
    verbose: bool = True,
) -> int:
    """Persist streaming JSON IoT events into MongoDB in micro-batches."""
    buffer: list[dict[str, Any]] = []
    inserted_total = 0

    for event in events:
        buffer.append(event)
        if verbose:
            printable = {
                **event,
                "timestamp": event["timestamp"].isoformat(),
            }
            print(json.dumps(printable))

        if len(buffer) >= batch_size:
            result = collection.insert_many(buffer, ordered=False)
            inserted_total += len(result.inserted_ids)
            buffer.clear()

    if buffer:
        result = collection.insert_many(buffer, ordered=False)
        inserted_total += len(result.inserted_ids)

    return inserted_total


def run_hourly_aggregation(
    collection: Collection,
    lookback_hours: int,
    avg_temp_threshold: float,
    peak_temp_threshold: float,
) -> list[dict[str, Any]]:
    """Execute the hourly aggregation pipeline and return formatted results."""
    pipeline = build_hourly_aggregation_pipeline(
        lookback_hours=lookback_hours,
        avg_temp_threshold=avg_temp_threshold,
        peak_temp_threshold=peak_temp_threshold,
    )
    results = list(collection.aggregate(pipeline))
    for row in results:
        if isinstance(row.get("hour"), datetime):
            row["hour"] = row["hour"].isoformat()
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Simulate streaming IoT logs, persist to MongoDB, and flag hourly thermal anomalies."
    )
    parser.add_argument(
        "--uri",
        default=os.getenv("MONGO_URI", "mongodb://localhost:27017"),
        help="MongoDB connection URI (defaults to MONGO_URI env var or localhost)",
    )
    parser.add_argument("--db", default="iot_telemetry", help="MongoDB database name")
    parser.add_argument(
        "--collection", default="sensor_logs", help="MongoDB collection name"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=160,
        help="Number of simulated JSON events to emit (0 for continuous stream)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.02,
        help="Delay in seconds between emitted sensor readings",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=25,
        help="Micro-batch size for MongoDB insert_many",
    )
    parser.add_argument(
        "--backfill-hours",
        type=int,
        default=4,
        help="Spread finite simulated events across the past N hours",
    )
    parser.add_argument(
        "--lookback-hours",
        type=int,
        default=24,
        help="Aggregation lookback window in hours",
    )
    parser.add_argument(
        "--avg-threshold",
        type=float,
        default=75.0,
        help="Hourly average temperature threshold in °C",
    )
    parser.add_argument(
        "--peak-threshold",
        type=float,
        default=85.0,
        help="Peak temperature spike threshold in °C",
    )
    parser.add_argument(
        "--anomaly-prob",
        type=float,
        default=0.08,
        help="Probability of injecting a thermal spike per reading",
    )
    parser.add_argument(
        "--mode",
        choices=["both", "stream", "aggregate"],
        default="both",
        help="Execution mode",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-event JSON log output while streaming",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    def handle_sigint(_sig: int, _frame: Any) -> None:
        print("\n[stream] Interrupted by user.", file=sys.stderr)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    client = MongoClient(args.uri, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except PyMongoError as exc:
        print(f"[mongo] Connection failed ({args.uri}): {exc}", file=sys.stderr)
        return 1

    db = client[args.db]
    collection = ensure_telemetry_collection(db, args.collection)

    if args.mode in ("both", "stream"):
        total = None if args.count == 0 else args.count
        stream = simulate_iot_stream(
            total_events=total,
            interval_seconds=args.interval,
            anomaly_probability=args.anomaly_prob,
            backfill_hours=args.backfill_hours if total is not None else 0,
        )
        inserted = stream_to_mongodb(
            collection=collection,
            events=stream,
            batch_size=args.batch_size,
            verbose=not args.quiet,
        )
        print(f"[mongo] Inserted {inserted} IoT telemetry documents.")

    if args.mode in ("both", "aggregate"):
        summary = run_hourly_aggregation(
            collection=collection,
            lookback_hours=args.lookback_hours,
            avg_temp_threshold=args.avg_threshold,
            peak_temp_threshold=args.peak_threshold,
        )
        print("\n=== Hourly Aggregation & Thermal Anomaly Report ===")
        print(json.dumps(summary, indent=2))

        anomalies = [row for row in summary if row.get("is_thermal_anomaly")]
        print(
            f"\n[summary] {len(summary)} hourly device buckets evaluated; "
            f"{len(anomalies)} thermal anomalies flagged."
        )

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
