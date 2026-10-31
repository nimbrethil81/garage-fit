# Manual editorial safety evidence pilot (GF-SR1–SR5)

Developer-only, synthetic evidence preparation; no app/UI or first-use impact.
This workflow does not certify safety, individual medical suitability, eliminate
negligence or grant public-launch clearance. No AI calls, uploads, review jobs,
notifications, content edits or issue creation occur automatically.

## Generate and replay

Use Node 22+ from the repository root, preferably a clean committed checkout:

```sh
node scripts/safety-review/export.js export /tmp/garagefit-review-baseline
node scripts/safety-review/export.js verify /tmp/garagefit-review-baseline
```

Use a fresh directory outside the repository. Keep the entire directory private.
It contains inputs.json, packet.json, review.md, findings.json and checksums.json.
The manifest pins seed, configuration, stable case identity and synthetic clock.
Packet provenance records source SHA, dirty status, Node version and hashes of
loaded source/tooling; require identical hashes for replay (a dirty SHA alone is
insufficient). Preserve the corresponding commit and use the recorded Node version.

```sh
git checkout SOURCE_SHA
node scripts/safety-review/export.js export /tmp/garagefit-review-replay /tmp/garagefit-review-baseline/inputs.json
```

Compare packet.json and inputs.json byte for byte. A dirty development packet must
be regenerated from its final clean commit before serving as a durable baseline.
Production workout IDs are clock-pinned; use case/session/occurrence IDs in findings,
not those workout IDs. Versions are preserved in resolved workout/policy records;
source hashes identify unversioned generator implementation. Schema version 1 is
shared by inputs, packet, findings and checksum documents. Unknown schema versions
are rejected. At most 64 cases and eight sessions per Coach sequence are allowed.
Failed cases produce nonzero export exit status; infeasible cases retain reasons.
Inspect both: infeasibility is not a successful safety review.

The baseline has 18 family cases (six current families, baseline, demanding and
restricted standing/low-impact/small-space configurations), three legacy Generator
cases, two authored fixed workouts and three four-session Coach sequences. This
provides approximately 31 delivered plans with the current catalogue. Four expected
restricted-family infeasibilities are retained. Keep baseline cases when extending
coverage; rotate additional seeds/equipment/durations/constraints as explicitly
labelled additional manifests. Coverage is representative, not exhaustive: Tennis,
all fixed workouts, every protocol/load configuration and long-term progression are
not fully covered. Sampling frequency/reachability never establishes safety.

Coach uses the real controller, store, engine and tracker in fresh in-memory storage.
Each sequence starts a fresh programme and advances three days between sessions,
with completed, partial, missed and completed outcomes. Partial confirms one Main
occurrence; missed previews save no result. No measured load is invented. State
before/after, actual synthetic results and policy rationale accompany every session.
These are simulation assumptions, not real participant evidence. Generator/Coach
plans include the shipped Ramp-up timeline and tracker prescriptions. Fixed workouts
retain authored order, rep targets and termination semantics; AMRAP rounds remain
open-ended and no invented rest/timing is added. Null fixed timeline/plannedWork
means that player does not expose a generated tracker plan. Catalogue instructions
and available approved layered guidance are separate from proposed targets. Missing
guidance is explicit; teaching drafts are not approved guidance.

## Primary review and independent challenge

A human chooses when and which AI receives a private packet; no review has been run
by exporting it. Supply these instructions with the packet:

> Assess the actual resolved occurrences, canonical instructions and available
> approved guidance. Review exercise suitability for the stated constraints,
> technique/setup clarity, load/dose, sidedness, ordering and fatigue, rest/recovery,
> equipment and space assumptions, and multi-session Coach progression after
> completed, partial and missed sessions. Distinguish planned work from synthetic
> performed evidence. Cite case/session/occurrence IDs and exact fields. Do not
> infer missing guidance, medical suitability or population-wide safety. Identify
> missing evidence and contradictions. Group repeated findings with all affected
> occurrences. Propose mitigations without editing any code or app content.

Use findings.json as the report template. Every finding needs concrete evidence,
plausible harm, severity (critical/major/minor/materially-uncertain), confidence
(high/medium/low) separately, uncertainty, suggested mitigation and authoritative
references with title, URL, access date and applicable quotation/limits where
appropriate. Unsupported assertions stay uncertain. Record reviewer/model/version,
review date, prompt and packet hash in the report alongside findings.

For every critical, major or materially uncertain finding, a human commissions an
independently framed challenge, preferably from another model. First provide the
same case and rubric without the primary conclusion and request independent
analysis; then ask it to test the proposed finding, alternatives, counter-evidence
and reference applicability. Record both stages, reviewer identity, disagreements
and outcome (supported/refuted/unresolved). Same-model challenge is a disclosed
limitation, not evidence of independent consensus. Do not discard disputed findings
or downgrade uncertainty merely because models agree.

A human explicitly accepts/rejects/defers each finding with rationale and date;
blank/deferred entries remain unresolved. Seek qualified professional judgement
where evidence or individual suitability requires it. Escalate critical/major and
materially uncertain findings to the human release owner. They remain unresolved
release considerations until that owner records disposition; this tool neither
blocks nor approves deployment. Acceptance of findings, remediation, issue creation,
content publication and launch decisions need separate authorisation. AI must never
auto-edit, auto-open issues or independently certify safety.

## Manual cadence and archives

A human may initiate a baseline review before launch, a change-triggered review
following material catalogue/guidance/generator/protocol/Coach changes, and a
quarterly review of baseline plus rotated risks. This is a procedure only: no
scheduler or notification is installed. Retain prior packets and compare findings
by stable case identity, with changed SHAs/inputs clearly distinguished.

Validate locally first. After editing findings, regenerate checksums for all four
expected files with standard SHA-256 tooling and validate again; preserve original
unreviewed packets separately. Package the complete directory in ZIP or tar and
record an external SHA-256 for the archive itself. Preferred manually selected
archive destination: Dropbox `/Apps/GarageFit/Safety Reviews/`, with date/SHA folder.
Do not include real users, identifiable health details or browser storage exports.
No upload is part of this script or required to use it.

After manual upload, download to a NEW directory, compare the archive SHA-256,
extract, then run `verify` against the downloaded directory. Record provider/path,
archive hash, upload/retrieval times and verification result in a local archive log.
A successful upload response alone is **uploaded-unverified**, never verified.
Use statuses local-verified, upload-failed, uploaded-unverified, retrieved-verified.
Retain local files on any failure. If Dropbox remains unreliable, explore the
existing GarageFit Google Drive folder manually and use the same upload/download
checks; record the actual chosen location. No mandatory integration, duplicate
sync, new database/account or service cost is introduced. Hashes detect accidental
corruption, not authenticity against a malicious replacement of files and manifest.

## Pilot-readiness report

Implementation pilot at source base `31d878d1a55125897b7a4dba097741ad0cf40acb`
produced 26 cases / 31 delivered plans: 22 generated cases and four truthful
restricted-family infeasibilities, with no failed cases. Three Coach sequences
retain completed/partial/missed history. Local checksum readback passed. Outputs
remain outside shipped assets. Automated regression checks exercise deterministic
replay, resolved work/rest, canonical instructions and missing guidance, fixed
AMRAP semantics, synthetic history, bounded inputs and corruption detection.

Status: **tooling ready for human-led independent AI assessment**. No assessment,
cloud upload, instructor certification or launch clearance has been performed.
Regenerate a clean-commit packet for the actual editorial pilot; record its exact
SHA and archive/review status with that packet. UI impact: none.
