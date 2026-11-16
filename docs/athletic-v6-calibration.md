# Athletic v6 General Fitness calibration

GF-AM6-CAL1 Option A authorises this version-specific deterministic policy. Released
General Fitness definitions remain unchanged. Their existing family balance, variety,
attendance and recovery machinery continues to apply; only Athletic **v6** receives
the contextual interpretation below. Athletic v1–v5 retains its released athletic-only,
non-demanding interpretation. No programme migration, result rewrite, global exercise
metadata, stored workload field or #400 policy is introduced.

## Evidence and calculation

Let **P** be resolved planned Main active seconds, **A** the bounded performed Main
active seconds, and **C** the subset of A performed with an exercise that has both
Athletic v6 `conditioning` membership and canonical `cardio >= 3`.

- Use the shared Generator's resolved timed exercise steps, expanding both sides of
  per-side work exactly as playback and the existing Session Tracker do. Exclude rests,
  transitions, preparation and finish using `blockTrainingSection()`.
- Saved results already contain one planned occurrence per performed side, its timed
  target and factual outcome. Completed outcomes without measured seconds derive their
  bounded duration from that explicit completion. Measured seconds take precedence,
  capped at the planned target. Quantified partials contribute their actual duration;
  skipped, zero, unknown and note-only partial work contributes no seconds.
- Main is identified by the saved `section: 'main'`; neither unknown sections nor
  preparation/finish contributes. Semantics follow the **performed** exercise, including
  substitutions, rather than the planned exercise.
- Conditioning membership is contextual; the global `conditioning` flag alone cannot
  qualify an exercise. In particular, light `cardio: 2` stepping/boxing alone never
  establishes conditioning credit or demanding work. Existing results do not persist
  block roles, so a dual-role movement is classified by this membership plus its
  canonical energetic rating, even when used for footwork or integrated practice.

The performed-session weight is `min(1, A/P)` (zero when P is zero).
Conditioning is credited only when **C ≥ 60 seconds** and **C/A ≥ 20%**. When it
qualifies, effect shares are `conditioning: min(1/3, C/A)` and the remainder athletic.
Otherwise the performed effect is athletic only. Multiplying these shares by A/P
means conditioning earns at most one third of the performed-session weight; effects
share the existing weight rather than awarding an extra whole conditioning session.
Athletic therefore retains at least two thirds of the effect share. A quarter cap
would compress modest and strongly energetic compositions into nearly the same small
contribution; a half cap would allow conditioning to tie the family's primary effect.
One third permits a meaningful secondary contribution while retaining clear Athletic
identity. This is a policy allocation, not a claim of physiological precision.

The delivered session is **demanding** only when **C ≥ 180 seconds** and
**C/A ≥ 30%**. This existing recovery-ordering flag is deliberately stricter than
receiving some conditioning coverage. The minute floor rejects incidental energetic
practice; the relative floor distinguishes a purposeful conditioning contribution
from a little energetic work inside a long technical session. The three-minute and
30% demand floors require both sustained cumulative energetic work and a substantial
part of the actual performed Main work. Skipped planned technical work cannot dilute
the same factual energetic workload. For example, 200 energetic seconds plus 100
technical seconds is demanding whether the original plan contained 600 or 900 active
seconds; its coverage weight still scales to 300/600 or 300/900. Short sessions can contribute conditioning
without automatically triggering the recovery preference.

These thresholds are operational planning choices using already approved exercise
ratings and explicit dose, not a new physiological measurement or fitness score.

## Planning and delivered work

Before composition, General Fitness does not know the selected v6 style or dose. On
an existing recovery-preferred day it conservatively applies the existing demanding
candidate penalty to the possible v6 session. The generated Coach preview then derives
`deliveredWorkload` from the actual resolved workout, recomputing on access after any
preview swap. This transient field is separate
from the workout, Session Prescription and Session Result and is never saved.

Subsequent recovery and coverage use existing persisted planned/performed occurrence
evidence through the same calculation. Style names, intended family and completion
of preparation alone never establish delivered demand. External-activity influence,
programme completion credit and the ordinary meaningful-Main rule remain unchanged.

## Bounded calibration evidence

Seven focused tests pass. They cover both released General Fitness definitions,
v1–v5 history, substantial and light work, thresholds, measured/unknown partials,
skips, zeroes, performed substitutions, preparation-only results, exact timeline
parity, skipped-plan demand invariance and the transient Coach preview after swaps.

The following bounded sample uses Normal, no kit, no confirmed movement room, LCG
seed 7 (`s = (1664525*s + 1013904223) >>> 0`, draws divided by 2^32) after initial
style draws 0, 0.5 and 0.9. Durations and both sides use resolved occurrence seconds.

| Minutes | Delivered style | Main active seconds | Energetic seconds | Energetic share | Conditioning effect share | Demanding |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 10 | movement-circuit | 316 | 114 | 36.1% | 33.3% | No |
| 10 | agility-balance | 315 | 76 | 24.1% | 24.1% | No |
| 10 | athletic-conditioning | 321 | 122 | 38.0% | 33.3% | No |
| 30 | movement-circuit | 939 | 277 | 29.5% | 29.5% | No |
| 30 | agility-balance | 980 | 173 | 17.7% | 0% | No |
| 30 | athletic-conditioning | 926 | 359 | 38.8% | 33.3% | Yes |
| 45 | movement-circuit | 1451 | 489 | 33.7% | 33.3% | Yes |
| 45 | agility-balance | 1371 | 253 | 18.5% | 0% | No |
| 45 | athletic-conditioning | 1494 | 640 | 42.8% | 33.3% | Yes |

This sample shows why neither the family nor style alone supplies recovery demand.
The short conditioning style remains below the absolute demand floor; the technical
agility style stays below the relative floor even at 45 minutes. The shared composer
retains responsibility for eligibility, fit and safe recovery. Required full-suite
and reachability validation is recorded with the implementation PR.
