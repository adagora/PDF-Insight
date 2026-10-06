# Performance baseline and ranked targets

Scenario: the supplied 12-page contract, including its scanned annex and injection attempt.
Budget: upload to visible, validated result under 30 seconds; no inspection omissions or
unsupported citations. The baseline contains 20 fresh Chromium inspections and 20 real-Gemini
API replays, measured separately. Initial browser runs received API errors and measure inspection only; they are not
successful end-to-end latency samples.

| Rank | Location                                   | Cost                                                                          | Category                      | Evidence                                                                                                   |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | `gemini.ts`: provider generation           | API p50 24.540 s, p95 28.005 s; 5/20 timeouts                                 | Remote wait/output generation | [API baseline](api-baseline.json), [summary](summary.json)                                                 |
| 2    | `visual-inspection.ts`: OCR recognition    | 25.215 s cumulative over 13 images, two workers; cold inspection p95 16.612 s | CPU/Wasm                      | [Spans](inspection-spans.json), [CPU samples](cpu-samples.json), [browser baseline](browser-baseline.json) |
| 3    | `visual-inspection.ts`: barcode decoding   | 1.427 s cumulative, 13 calls                                                  | CPU/Wasm and worker transfer  | [Spans](inspection-spans.json)                                                                             |
| 4    | `visual-inspection.ts`: OCR initialization | 0.724 s cumulative, two workers                                               | Asset I/O and initialization  | [Spans](inspection-spans.json)                                                                             |
| 5    | `browser-inspection.ts`: page rendering    | 0.301 s cumulative, 12 calls                                                  | CPU/canvas                    | [Spans](inspection-spans.json)                                                                             |

These cumulative browser spans overlap; adding them does not yield end-to-end latency.
PDF object inspection adds 0.204 s. The raw Chrome trace is retained locally in
`/private/tmp/pdf-insight-perf-spans/trace.private.json`; the published frame counts omit URLs,
document content and request headers. Third-party Wasm has anonymous function numbers, so its
frames support the OCR CPU attribution without identifying engine source lines.

The complete metric distributions, throughput, RSS/heap and CPU observations are in
[summary.json](summary.json); host/toolchain/build limitations are in
[fingerprint.json](fingerprint.json). API throughput was 0.0406 ops/s and 2,209 input bytes/s.
API peak RSS was 91.4 MiB and sampled heap high-water was 29.1 MiB. API CPU averaged 0.182%,
while the Chrome-process snapshots averaged 185% of one core. Baseline Chrome RSS includes
pre-existing Chrome processes and is an upper bound, not workload-specific peak RSS. Page heap
excludes workers. PSS and per-core process allocation were unavailable on this macOS run.

With 20 samples, p99, p99.9 and p99.99 equal the observed maximum; they do not estimate population
tails. Browser p95 rose from 14.587 s in the first ten samples to 16.631 s in the last ten
(14% drift). Keep the conservative later bound: ordinary host activity, thermal state and
instrumentation may contribute; no governor/kernel settings were changed. Provider variation
is part of the real workload, with a 14.2% coefficient of variation.

## Hypothesis ledger and hand-off

| Hypothesis                                           | Verdict                | Evidence and implication                                                                                                                                    |
| ---------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider wait and output length dominate API latency | Supports               | 1,690–4,156 output tokens per completed call, approximately 17,700 input tokens; provider wait accounts for almost all API wall time in `api-baseline.json` |
| Retry has enough deadline margin                     | Rejects                | Five first answers were invalid; correction then hit the shared 28 s deadline                                                                               |
| Browser OCR is the local bottleneck                  | Supports               | OCR consumes 25.215 s cumulative; busy sampled frames are predominantly Wasm; rendering totals only 0.301 s                                                 |
| Cold language downloads explain most inspection time | Rejects on this host   | Two complete OCR initializations total 0.724 s; recognition is much larger. Remote Pages downloads still require public measurement                         |
| Worker/Node CPU explains the 24 s API wait           | Rejects for this input | Median process CPU is 37.9 ms; Node CPU is not a substitute for the production Worker budget                                                                |
| A faster configured model can provide latency margin | Candidate              | Compare one model at a time with the same request/prompt/validation; quality must retain injection resistance, scanned-annex facts and citations            |

The profiling hand-off is complete. Its highest-ranked opportunity is provider/model selection
(impact 9 × confidence 8 / effort 1 = 72); OCR execution is second (8 × 9 / 5 = 14.4).
Optimization work must retain complete admission/inspection and use fresh browser measurements,
not the tab cache, to demonstrate the public acceptance budget.

Scaling is not extrapolated from the 12-page measurement. Full OCR applies to every admitted
page; 100 pages is the inspection ceiling, and 500/1,000-page browser inputs are rejected.
One-page quality cases are separately recorded by the evaluator. No unmeasured 10/50/100-page
p95 ratios are claimed. Remote/public browser delivery is measured separately below.

## Measured changes

Each candidate uses the same inspected request and host; all failures remain in the artifacts.
The configured model remains `gemini-3.8-flash` with low thinking. Model-only replacement was
rejected because its 18/20 valid results and slower tails left insufficient end-to-end margin.

| Variant                                            | Valid results | API p50  | API p95  | Maximum  | Evidence                                            |
| -------------------------------------------------- | ------------- | -------- | -------- | -------- | --------------------------------------------------- |
| Original combined extraction                       | 15/20         | 24.540 s | 28.005 s | 28.024 s | [Baseline](api-baseline.json)                       |
| Model 3.5 only                                     | 18/20         | 11.055 s | 20.934 s | 25.150 s | [Model comparison](model-35.json)                   |
| Concurrent field groups, model-written quotes      | 20/20         | 14.049 s | 22.267 s | 26.303 s | [Scheduling](parallel-fields.json)                  |
| Source-copied quotes, strict suggested page        | 13/20         | 11.734 s | 20.859 s | 28.005 s | [Rejected strict-page variant](source-context.json) |
| Source-copied quotes and supported-page resolution | 20/20         | 7.225 s  | 9.873 s  | 9.892 s  | [Final measurements](source-page-final.json)        |

The final API p95 is 64.7% lower than the baseline. All 20 final results retain the 13,100 PLN
annex amount and injection warning, without extracting the injected 1 PLN. There were no
correction retries in this sample. Source lookup resolves a model's incorrect page hint to a
verified occurrence; absent values still fail. Contexts are copied, not generated (ADRs 0021–0023).

Trade-offs: large chunks use three provider calls and repeat their input, increasing input-token
usage. Node peak RSS rose from 91.4 to 151.2 MiB; sampled heap high-water rose from 29.1 to
56.3 MiB. The diagnostic harness parses provider outputs and constructs source indexes in addition
to the application, so its 1.82% average process CPU is not a production Worker CPU measurement.
Final replay throughput is 0.1273 ops/s; it excludes browser inspection and Cloudflare runtime.
The last few final samples overlapped static verification; this host was not CPU-pinned or fully
isolated. Remote wait dominates these calls, while public browser checks establish the total budget.
The 20-sample maximum is a conservative observed tail, not a population p99 estimate.

## Published application measurements

The production Pages build at `fbf1315` and the deployed Worker were measured with 20 sequential
uploads of the same contract. Each run starts a fresh Chromium process/context and alternates
desktop 1366×900 with mobile 360×780. Browser requests use the public Worker directly with native
CORS; no route proxy, tab cache, test/build workload or profiling instrumentation is used.
The OS filesystem remains warm and ordinary host activity remains possible. The scenario and
source/build identifiers are in [public-scenario.json](public-scenario.json).

| Measurement                        | Result                                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| Visible, schema-valid results      | 20/20                                                        |
| Upload-to-result latency           | p50 25.433 s; p95 29.105 s; maximum 41.013 s                 |
| Under 30 seconds                   | 19/20; desktop 9/10, mobile emulation 10/10                  |
| Local inspection/preparation       | p50 16.823 s; p95 19.786 s; maximum 21.123 s                 |
| API request through final display  | p50 7.765 s; p95 12.273 s; maximum 23.650 s                  |
| Source-linked amount/date contexts | No invalid citations in any result                           |
| Annex and injection                | All retain 13,100 PLN and flag injection; none extract 1 PLN |
| Extracted counts                   | 40 amounts in all results; 29 dates in 18, 28 dates in two   |

All [samples](public-samples.json) are retained, including the slow seventeenth run.
[public-summary.json](public-summary.json) includes per-viewport and first/last-ten distributions.
The slow run spent 17.363 s before the API request and 23.650 s from that request to display;
these intervals establish where the delay occurred, without identifying its provider/runtime
cause. With only twenty observations, p99 equals the maximum and is not a population estimate.
Ten samples per viewport are also insufficient to characterize platform tails. Date-count
variation and valid citations do not establish exhaustive extraction.

The combined cohort's p95 is under the target, but its 41-second result means the application
does not reliably meet the 30-second acceptance target. Physical phones, Safari, slower networks,
concurrent users and larger inputs remain unmeasured. A first timing cohort overlapped a separate
smoke browser; it was stopped and excluded before this complete cohort began. Both its completed
sample and caller cancellation are retained in [public-overlap-aborted.json](public-overlap-aborted.json).

The published supplied-PDF smoke and live desktop/mobile checks pass. The availability checker
initially failed its real-analysis check after 28.796 s while assets, health and CORS passed;
the follow-up passed in 11.102 s, with analysis taking 10.763 s. Both
[initial](initial-public-check.json) and [follow-up](final-public-check.json) observations are
retained. The original artifact did not record HTTP status/error code, so it cannot establish the
failure cause. The checker now records both without response content. The six-hourly workflow
begins observation; a 14-day availability claim still requires fourteen days of evidence.

## Reproduce

Use the scenario/fingerprint files alongside the measurements. `scripts/profile-analysis.ts`
replays a schema-valid, already inspected request with the ignored local Gemini credential:

```bash
node --import tsx scripts/profile-analysis.ts --input /private/tmp/request.json --out /private/tmp/perf/samples.jsonl --runs 20
```

This command makes real provider requests. It records codes, IDs, counts and token usage;
it does not save source text, responses or keys. Browser spans are enabled only in a separate
profiling build with `VITE_PROFILE_INSPECTION=1`, source maps and a separate output directory.
The flag is absent from production builds. Normal checks remain unchanged.
