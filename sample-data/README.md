# Sample data — demo content for Azure Scientific Podcast Studio

This folder holds human-readable seed/demo content referenced by the app's
mock data layer (`apps/web/src/data/seed.ts`). It mirrors the three script
patterns required by the specification (Section 4.4 / Section 13):

1. **Plain narration** — `scripts/plain-narration.md`
2. **Structured narration with delivery cues** — `scripts/structured-narration.md`
3. **Host / Expert discussion** — `scripts/host-expert.md`

The demo topic is a German-language HIV-1 research briefing that compares an
investigational **Doravirine / Islatravir** regimen against a
**Bictegravir / Emtricitabin / Tenofovir-Alafenamid** comparator. It exercises
mixed German/English medical terminology, drug names, trial identifiers,
percentages, confidence intervals, dosages, and week numbers.

## Important: pronunciation provenance

`pronunciation-seed.json` seeds candidate terms **as review candidates only**.
No entry is treated as an authoritative "correct" pronunciation. Every entry
carries `approvalStatus` and a `rationale`/provenance field and must be reviewed
and approved by an authorized reviewer before it influences synthesis
(Specification Section 13).

> This is synthetic demo content for a software demonstration. It is **not**
> medical advice and does not describe a real clinical recommendation.
