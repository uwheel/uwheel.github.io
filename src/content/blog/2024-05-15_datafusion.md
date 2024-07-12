---
title: Speeding up Temporal Aggregation in DataFusion by 60-60000x
slug: datafusion
author: Max Meldrum
description: Using µWheel for Temporal OLAP Indexing
tags:
  - datafusion
  - olap
  - indexing
  - rust
published_at: 2024-05-15T21:31:26.761Z
last_modified_at: 2024-05-15T21:31:26.761Z
image: /media/posts/berg4.jpg
---

[µWheel](https://github.com/uwheel/uwheel) is a unified aggregate management system for streams and queries. While the system is mainly designed for streaming workloads, it can also be used for OLAP indexing.
In this post, I'll show the potential of using µWheel as an index within or on top of [DataFusion](https://datafusion.apache.org/) to significantly speed up temporal aggregation queries.

There is an ongoing discussion about [indexing support](https://github.com/apache/datafusion/discussions/9963) in DataFusion
and the following time-based analytical processing systems could benefit from native µWheel indexing support:


* [InfluxDB](https://github.com/influxdata/influxdb) - Time Series Database
* [HoraeDB](https://github.com/apache/incubator-horaedb) - Distributed Time-Series Database
* [Arroyo](https://github.com/ArroyoSystems/arroyo) - Distributed stream processing engine
* [GreptimeDB](https://github.com/GreptimeTeam/greptimedb) - Distributed Time-Series Database
* [CnosDB](https://github.com/cnosdb/cnosdb) - Distributed Time-Series Database

Post Overview:

- [Dataset & Queries](#dataset-and-queries)
- [DataFusion Baseline](#datafusion-baseline)
- [Building the µWheel index](#building-our-µwheel-index)
- [µWheel query execution](#µwheel-query-execution)
- [µWheel Performance](#µwheel-performance)
- [Summary](#summary)


# Dataset and Queries

We'll use the NYC Taxi Dataset from the year 2022 and the month of January for our benchmark.
The data is stored as Parquet. Now let us imagine that the following SQL query is frequently being executed to answer the total generated ride revenue within a time range.

```sql
SELECT SUM(fare_amount) FROM yellow_tripdata
WHERE tpep_dropoff_datetime >= '?' and < '?'
```
So now the question is, can we acheive low latency and highly interactive querying over arbitrary time ranges using purely DataFusion + Parquet?

# DataFusion Baseline

We generate 20000 random time ranges with both **minute** and **hour** granularities between ``2022-01-01`` and  ``2022-01-31``, and record the latency of executions.
Furthermore, we enable the mimalloc allocator and run things using a single-threaded tokio runtime since adding more tokio workers did not really improve the DataFusion performance
for our workload.

Benchmark code used is available [here](https://github.com/uwheel/uwheel-datafusion) and the runs were executed on a MacBook Pro M2 machine.

| System     | p50 | p99 | p99.9 |
| ---------- | --- | --- | --- |
| DataFusion (Minute Ranges) | 65559µs | 68887µs | 73375µs |
| DataFusion (Hour Ranges) | 64793µs | 67667µs | 72071µs |

While the latencies are under 100ms, it is not really the ideal performance for highly interactive querying.

# Building our µWheel index

To build an µWheel index on top of Parquet data, we need the following: 1) an aggregation function; 2) a starting low watermark; 3) a wheel configuration; 4) a final low watermark to advance to once data has been ingested.

Since we are aggregating the fare amount from the NYC taxi dataset we'll use µWheel's built-in [F64SumAggregator](https://docs.rs/uwheel/latest/uwheel/aggregator/sum/struct.F64SumAggregator.html).  Also, since we know the start and end dates for our parquet data file (``2022-01-01`` and ``2022-01-31``), we can hardcode it during our building implementation.

The process of building the µWheel index is as follows: First, initialize a [Reader-Writer Wheel](https://docs.rs/uwheel/latest/uwheel/wheels/struct.RwWheel.html) with a start low watermark and also configuration. In this example, we set the wheel to retain aggregates at the wheels of the minutes, hours, and days.

```rust
let start = NaiveDate::from_ymd_opt(2022, 1, 1)
    .unwrap()
    .and_hms_opt(0, 0, 0)
    .unwrap();
let date = Utc.from_utc_datetime(&start);
let start_ms = date.timestamp_millis() as u64;

let mut conf = HawConf::default()
    .with_watermark(start_ms);

conf.minutes.set_retention_policy(RetentionPolicy::Keep);
conf.hours.set_retention_policy(RetentionPolicy::Keep);
conf.days.set_retention_policy(RetentionPolicy::Keep);

let rw_conf = Conf::default().with_haw_conf(conf);
let mut wheel = RwWheel::with_conf(rw_conf));
```

Secondly, we scan the parquet file and filter the ``fare_amount`` and ``tpep_dropoff_datetime`` columns, which are used to create a wheel entry.

```rust
let dropoff_array = batch
.column_by_name("tpep_dropoff_datetime")
.unwrap()
.as_any()
.downcast_ref::<TimestampMicrosecondArray>()
.unwrap();

let fare_array = batch
.column_by_name("fare_amount")
.unwrap()
.as_any()
.downcast_ref::<Float64Array>()
.unwrap();

for (date, fare) in dropoff_array
.values()
.iter()
.zip(fare_array.values().iter())
{
  let ts = DateTime::from_timestamp_micros(*date as i64)
	  .unwrap()
	  .timestamp_millis() as u64;
  let entry = Entry::new(*fare, ts);
  wheel.insert(entry);
}

```

Finally, once all entries have been inserted, we advance our wheel's time (low watermark) to ``2022-01-31``.
The whole building process takes around 1 seconds on my MacBook Pro M2 where most of the time is spent on advancing the wheel.


```rust
wheel.advance(31.days());
```

Our queryable wheel index now contains 44640 minutes, 744 hours, and 31-day aggregates, resulting in a size of around 1.3 MiB. Note that this size could be much smaller if we utilize compression within µWheel.

# µWheel Query Execution

To execute our queries in µWheel we use the ReaderWheel's [combine_range_and_lower](https://docs.rs/uwheel/latest/uwheel/wheels/read/struct.ReaderWheel.html#method.combine_range_and_lower) function to aggregate a time range.
Internally, µWheel utilises its wheel-based query optimizer that finds optimal plans based on context such as SIMD, algebraic properties, and time.

```rust
for (start, end) in ranges {
  let range = WheelRange::new_unchecked(start, end);
  let res = wheel.read().combine_range_and_lower(range);
}
```

Below is an example query execution plan that µWheel generated and executed given the time range ``2022-01-16 6:17:00`` and ``2022-01-27 11:09:00``.

```bash
CombinedAggregation {
    aggregations: [
        WheelAggregation {
            range: WheelRange {
                start: 2022-01-16 6:17:00.0 +00:00:00,
                end: 2022-01-16 7:00:00.0 +00:00:00,
            },
            plan: Scan(
                43,
            ),
            slots: (
                22620,
                22663,
            ),
            granularity: Minute,
        },
        WheelAggregation {
            range: WheelRange {
                start: 2022-01-27 11:00:00.0 +00:00:00,
                end: 2022-01-27 11:09:00.0 +00:00:00,
            },
            plan: Scan(
                9,
            ),
            slots: (
                6531,
                6540,
            ),
            granularity: Minute,
        },
        WheelAggregation {
            range: WheelRange {
                start: 2022-01-16 7:00:00.0 +00:00:00,
                end: 2022-01-17 0:00:00.0 +00:00:00,
            },
            plan: Scan(
                17,
            ),
            slots: (
                360,
                377,
            ),
            granularity: Hour,
        },
        WheelAggregation {
            range: WheelRange {
                start: 2022-01-27 0:00:00.0 +00:00:00,
                end: 2022-01-27 11:00:00.0 +00:00:00,
            },
            plan: Scan(
                11,
            ),
            slots: (
                109,
                120,
            ),
            granularity: Hour,
        },
        WheelAggregation {
            range: WheelRange {
                start: 2022-01-17 0:00:00.0 +00:00:00,
                end: 2022-01-27 0:00:00.0 +00:00:00,
            },
            plan: Scan(
                10,
            ),
            slots: (
                5,
                15,
            ),
            granularity: Day,
        },
    ],
  },
)
```


# µWheel Performance

We now execute the same time ranges in µWheel. It is important to note that there is some additional noise in DataFusion since it parses a SQL query whereas queries in µWheel do not require any form of parsing. However it should
have limited impact on the the overall execution time. Finally, explicit SIMD support was disabled for µWheel.

| System     | p50 | p99 | p99.9 |
| ---------- | --- | --- | --- |
| DataFusion (Minute Ranges) | 65559µs | 68887µs | 73375µs |
| DataFusion (Hour Ranges) | 64793µs | 67667µs | 72071µs |
| µWheel (Minute Ranges)    | **984µs**   | **1038µs**   | **1090µs**   |
| µWheel (Hour Ranges)    | **1µs**   | **1µs**   | **1µs**   |

The results show that µWheel has significantly lower tail latencies. This of course makes sense since it pre-materializes aggregates over multiple time dimensions, uses event-time indexed wheel slots
which enables fast lookups, and employs a specialized query optimizer whose cost function aims to minimize the number of aggregate operations required for any arbitrary time range.

For the hour ranges, µWheel mostly spends time aggregating across its hour wheel with 744 slots which is more CPU friendly compared to jumping around and aggregating
across minutes, hours, and day wheels. Introducing compression at the minutes dimension making µWheel more cache friendly could potentially improve the overall performance.

# Summary

µWheel is an embeddable aggregate management system for streams and queries. It is highly space-efficient and executes temporal aggregation queries at low latencies
through a wheel-based optimizer that finds optimal plans based on context such as SIMD, algebraic properties, and time.

In this post we show the potential of embedding µWheel as an index to DataFusion to significantly speed up temporal aggregation queries on top of Parquet data.
An integration that could provide out-of-the-box
performance improvements for projects that use DataFusion for time-based analytical processing.

Benchmark [repo](https://github.com/uwheel/uwheel-datafusion) \
µWheel [repo](https://github.com/uwheel/uwheel)
