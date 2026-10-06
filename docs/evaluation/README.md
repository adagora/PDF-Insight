# Reviewed AI cases

`cases.json` contains six authored fixtures with reviewed source expectations: Polish invoice,
English offer, German report, French agreement a sparse Polish note and a long invoice appendix exercising concurrent extraction. They distinguish money
from percentages/counts, absolute dates from relative periods, named parties/people and absent
information. These are synthetic fixtures, not additional customer documents.

The real-provider evaluator uses the same `createApp` pipeline and boundary validation as the
Worker. It checks the full schema, language/type/main date, exact amount/date/entity sets and
required summary facts. Required words do not prove every summary sentence is factually correct;
reviewed fixtures complement the supplied real contract and its scanned-annex/injection checks.

```bash
node --import tsx scripts/evaluate-ai.ts --out /private/tmp/quality.json --model gemini-3.8-flash
```

The ignored local Gemini key must be configured. Results contain check outcomes and timings,
with no key or document content. The production availability checker independently proves a
small real analysis through the public Worker, plus Pages assets and CORS. Its six-hourly Actions
workflow preserves dated evidence for 30 days; 14-day availability needs 14 days of observation.
