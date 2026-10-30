# GarageFit portable backup records

**Preparatory implementation for #354; not shipped or wired into the app.**
The approved Dropbox reference pack is located at
`/Apps/GarageFit/Design References/Backup & Restore/GarageFit-Backup-Restore-Visual-References-v1.0.zip`,
but the implementation workspace's HTTP policy blocks its download. Dropbox's
text-extraction tool can read its README: it confirms 24 approved conceptual
mockups covering 12 states in light/dark, at 390 × 800 CSS pixels. It does not
expose the image contents for visual inspection. The issue
requires those approved references before visual implementation. This branch
therefore contains storage APIs, the format registry and a tested coordinator;
it must not be merged as a completed #354 feature.

Still required: approved-reference inspection and current iPhone baseline
captures; Settings screens and navigation; native save/share/download transport
and truthful save statuses; startup recovery before mutable clients; browser
tab protection and pending-write/activity guards; client reinitialisation;
light/dark, narrow viewport, focus and real iPhone PWA verification.

The portable data domain is curated, not a dump of browser storage. Register any
new durable feature explicitly, validate its stored representation and add a
round-trip fixture before shipping it. Unknown keys remain on the destination
and are never exported or deleted by replacement.

## Non-Coach registry

`js/backup-registry.js` owns the exact included non-Coach keys. Validation keeps
their original strings; it does not migrate values, prune older history or
replace malformed records with defaults. A damaged or unsupported record blocks
the operation. Absence is distinct from a stored empty array, `false`, `null` or
an explicit bodyweight-only choice.

| Keys | Classification | Stored representation |
| --- | --- | --- |
| `gf_equipment_inventory`, `gf_equipment_configured` | Included | JSON equipment ID array and string boolean; an empty configured inventory means bodyweight only |
| `gf_equipment` | Included legacy | String boolean still interpreted by equipment startup; preserved alongside modern keys when present |
| `gf_generator_duration`, `gf_generator_focus`, `gf_generator_difficulty`, `gf_generator_body_focus` | Included | Existing selectable string values |
| `gf_generator_history` | Included | JSON array of exercise-ID arrays; no export truncation |
| `gf_300_pb_seconds` | Included | Non-negative integer string |
| `gf_amrap_results` | Included | JSON array retaining workout identity, termination, duration, completed rounds, additional and partial reps, and completion date |
| `gf_routine_variant` | Included | `bodyweight` or `equipment` |
| `gf_routine_recent_v1` | Included | Version 1 warm-up and cool-down session lists; legacy exercise-ID arrays and dated `{ids, completedAt}` entries both retained |
| `gf_desk_break_recent_v1` | Included | JSON array of six distinct exercise-ID arrays |
| `gf_post_run_recent_v1` | Included | JSON exercise-ID array |
| `gf_appearance_v1` | Included | `automatic`, `light` or `dark` |
| `gf_spoken_voice_v1` | Included | JSON voice identity `{voiceURI, name, lang}` or `null` for system default; device availability does not change the identity |
| `gf_first_use_v1` | Included | Version 1 audience, explored state, mode dismissals and first-completion acknowledgement |
| `gf_workout_diagnostics_v1` | Excluded | Build/debug diagnostics, not training evidence |
| `gf_restore_journal_v1`, `gf_restore_reserve_v1` | Excluded internal | Recovery snapshot and temporary quota reserve; startup recovery owns these, never portable backups |
| Unknown/third-party/browser keys | Excluded and untouched | No wildcard inclusion or global storage clearing |

Retired exercise IDs remain valid historical identities in recency and results;
validation must not filter them against today's catalogue. Unknown equipment is
incompatible because current equipment startup would silently discard it.
History record counts are not capped to today's UI or recency retention limits.
An archive exceeding the coordinator's resource bound is rejected as a whole.

## Coach ownership and derived data

Coach record layout belongs exclusively to `js/coach-store.js`. Its narrow
snapshot and replacement APIs own active programme references, versioned
programme states, immutable Session Results and Coach preferences. The session
result index is derived/rebuildable from individual results; displayed Progress
and Training History summaries are also derived and are never separate backup
records. Session drafts and active player state are transient and excluded from
portable backups; unresolved work must block export and restore rather than be
silently discarded. Transaction recovery must preserve the original registered
state, including any derived records needed for exact rollback.

## Maintenance check

`node --test tests/backup-registry.test.js` checks production non-Coach storage key
literals against the included/excluded lists and verifies malformed records fail
without mutation. It also protects valid older representations and histories
longer than present-day UI retention limits. Dynamic Coach key families are
covered by Coach store tests; coordinator journal/lock keys are internal recovery
state, never portable data.

## Archive and coordinator

`js/backup.js` exposes `GarageFitBackup.create({storage, coach, registry,
isBlocked, withExclusive, now})`. The Coach argument is the synchronous
`GarageFitCoachStore.createBackupAccess(storage)` boundary. Nothing is mounted
by loading the module.

Format 1 archives contain `app: "GarageFit"`, an ISO `createdAt`, separate
version-1 `preferences` and `coach` sections, and a lowercase SHA-256 `checksum`
over the canonical archive excluding the checksum field. Canonical JSON sorts
object property names while retaining array order. Each section uses unique
`[storageKey, rawString]` entries, preserving exact stored bytes. Coach's derived
index is not portable; materialisation rebuilds it from validated records.
All sections are mandatory even when empty. Unknown sections, fields, keys,
versions, duplicate JSON members and duplicate entries reject; no partial import
or history clipping is supported. Archives are bounded to 8 MiB UTF-8 and JSON
nesting to 64; Coach scans have their existing 10,000-storage-key bound and reject
rather than truncate. Recovery journals have a separate 24 MiB bound.

`prepare()` validates a consistent complete snapshot and returns a file with
status `prepared`, never `saved`. `verify(text)` reselects and independently
checks the exact prepared file's checksum and identity. `prepare({preserve:true})`
and `verify(text,{preserve:true})` establish a distinct preservation gate tied to
the exact current destination snapshot. A user-reported save cannot establish
this gate. All registered destination evidence counts as meaningful, including
settings, first-use and partial sessions. Changed data invalidates verification.
`restore(text,{confirmed:true})` independently validates the archive again and
requires the preservation gate plus the caller's separate explicit confirmation.

Replacement is journalled, not a claim that localStorage has transactions. The
coordinator stores exact original and staged replacement snapshots with a journal
checksum, preflights a temporary capacity reserve while originals remain intact,
then replaces only registered keys. Failed writes attempt exact rollback; an
unresolved rollback retains the journal and blocks further operations. The
startup caller must invoke and await `recover()` before any equipment migration,
first-use classification, Coach reconciliation, Progress queries or write-on-load.
Recovery reverts a pending journal to the exact original snapshot and fails closed
if the journal or storage cannot be used. Success requires a full reload or
reinitialisation of every stateful client before any other app mutation.

**Required integration contract:** `withExclusive(action)` must prevent *all*
competing app writes, not only another restore. Merely requesting a Web Lock
inside `restore` is insufficient when other tabs write without acquiring that
lock. One viable integration is a shared app-lifetime tab lease acquired before
mutable startup, upgraded to an exclusive lease only while the initiating tab's
own writes are suspended and other tabs are closed. Recovery needs startup
exclusive ownership. Unsupported protection must disable destructive restore.
`isBlocked` must include all live/paused activities, pending specialised result
saves, tracker finalisation and other writes; persisted drafts also block directly
through the Coach API. The draft coordinator accepts these capabilities by
injection for deterministic testing; **browser integration is outstanding**.

Validation: `node --test tests/backup.test.js tests/backup-registry.test.js
 tests/coach-backup.test.js`, followed by the repository's full persistence suite.
Fault tests cover each significant storage write/delete and reload from each
persisted intermediate state; these do not replace browser integration or real
iPhone file-handling tests.
