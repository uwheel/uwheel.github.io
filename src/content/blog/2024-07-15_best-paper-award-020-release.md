---
title: Best Paper Award + 0.2.0 Release
slug: best-paper-award-020-release
description: µWheel receives best paper award at DEBS24
author: Max Meldrum
tags:
  - debs
  - release
  - rust
published_at: 2024-07-15T09:30:59.532Z
last_modified_at: 2024-07-15T09:30:59.532Z
image: /media/posts/debs_award.JPG
---

``µWheel: Aggregate Management for Streams and Queries`` [[PDF]](https://maxmeldrum.com/assets/files/uwheel_debs24.pdf) was awarded best paper at the 18th International ACM Conference on Distributed and Event-Based Systems (DEBS24) that took place in Lyon, France between 25-28 June.

I had a great time presenting the paper and discussing the work with the DEBS community.

## Stream and Batch Interoperability

Tyler Akidau from Snowflake presented a keynote titled ``Simplicity and Elegance in Stream Processing: A Five-Year Odyssey``. A key point he made was that to achieve true interoperability between stream and batch processing, systems need to maintain continuous queries over streaming data while simultaneously supporting ad-hoc queries that return consistent results.

<p align="center">
  <img width="500" height="500" src="/media/posts/debs_unified_stream_batch.jpg">
</p>

µWheel passes the litmus test and does this by integrating and respecting the concept of ``Low Watermarking``. Late data that exceeds the watermark is rejected and this ensures that queries over streaming data are consistent with ad-hoc batch queries.

## 0.2.0 Release

The ``0.2.0`` release of µWheel is now available. This release includes a number of new features and improvements. Full changelog can be found [here](https://github.com/uwheel/uwheel/blob/main/CHANGELOG.md#020-2024-07-13).

**Highlights Below!**

### Session Windowing

``0.2.0`` introduces session windowing support. [Session windowing](https://nightlies.apache.org/flink/flink-docs-master/docs/dev/datastream/operators/windows/#session-windows) is a type of windowing that groups events that are separated by a certain period of inactivity.

The following snippet demonstrates how to install a session window with a 10 second inactivity gap.

```rust
use uwheel::{aggregator::sum::U64SumAggregator, NumericalDuration, RwWheel, Window};

fn main() {
    let start_watermark = 0;
    let mut wheel: RwWheel<U64SumAggregator> = RwWheel::new(start_watermark);

    // Install session window with 10 second inactivity gap
    wheel.window(Window::session(10.seconds()));
}
```

### Group By Query

``0.2.0`` introduces group by functionality. This allows users to downsample aggregates over a certain time period.
For instance, the following SQL-like query groups data into 1 hour intervals between the
dates ``2023-11-09 00:00:00`` and ``2023-11-19 00:00:00``.

```sql
select sum(column) from some_table
group by ([2023-11-09T00:00:00, 2023-11-19T00:00:00), 1h);
```
Is equivalent to the following µWheel execution:
```rust
// A Hierarchical Aggregate Wheel
let haw: Haw<_> = ...;
// define range between 2023-11-09 00:00:00 and 2023-11-19 00:00:00
let range = WheelRange::new_unchecked(
    1699488000000,
    1699488000000 + 10.days().whole_milliseconds() as u64,
);
let result = haw.group_by(range, 1.hours()),
```

### MinMax Aggregator

``0.2.0`` introduces the [MinMax](https://docs.rs/uwheel/latest/uwheel/aggregator/min_max/index.html) aggregator. This aggregator keeps track of the minimum and maximum values. This aggregator is useful for temporal pruning/filtering queries that enables systems to avoid scanning irrelevant data.


## Get in touch

Connect with µWheel:

- Join the [Discord](https://discord.gg/dhRxfck9jN) community for discussions and updates.
- For academic or industrial collaborations, reach out to max@meldrum.se
