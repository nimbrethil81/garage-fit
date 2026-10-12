# Tennis capability mapping and catalogue gaps

Reviewed against main `2d83afc` (including PR #86's 13 exercises and #88's
sport settings). `data/exercises.js` remains canonical and unchanged. Mapping
`tennis-conditioning` v1 in `data/sport-capabilities.js` is an explicit editorial
review, not inference from patterns/planes or evidence of improved tennis performance.
No exercise additions or intrinsic metadata changes are needed here.

## Coverage available now

All six capabilities retain a minimum of some positive known performed exposure
in the rolling 14-day view, with four core and two complementary priorities.
This is a qualitative coverage floor, not a prescribed dose or a claim that a
single occurrence meets a physiological training requirement. Focus preferences
add emphasis: Movement → lateral/lower-body/trunk; Power → power/lower-body/trunk;
Endurance → conditioning; Resilience → lower-body/trunk/upper-body. They never
remove Balanced coverage or create catch-up debt. Mobility stays preparation,
cooldown or targeted support rather than a seventh capability.

| Capability | Bodyweight generated Main | DB/KB/TRX/pull-up kit adds | Limit |
| --- | --- | --- | --- |
| Lower-body (core) | Squat, reverse lunge, glute bridge, lateral lunge, Cossack squat | Loaded squats/hinges, TRX split squat/bridge, single-leg hinges | Strength/stability exposure, not lateral braking inferred from all lunges |
| Lateral movement/deceleration (core) | Lateral lunge/Cossack for control; skater jumps for lateral landing/braking | No reviewed low-impact braking alternative | Skaters are hard/high impact and need sideways landing space; controlled stepping is a different facet |
| Trunk (core) | Plank, side plank, dead bug for control | Plank pull-through/renegade row; wood chop, KB Russian twist, TRX power pull for rotation | Bodyweight generated rotation is underrepresented; fixed-only push-up rotation can classify performed work but is unavailable to Generator |
| Shoulder/upper body (core) | Push-up | Presses/rows/pull-ups; reverse fly, TRX T/Y fly, lateral raise for shoulder support | Bodyweight shoulder-support/pulling is underrepresented; general conditioning is not injury-prevention evidence |
| Explosive power (complementary) | Squat/skater jumps | Swings, clean, snatches, push press | No reviewed rotational-power exercise; transverse-plane chops/twists and the name “power pull” do not establish it |
| Match endurance/repeated efforts (complementary) | Climbers, jacks, high knees, burpees | Thruster, swing, TRX climber | Only general-conditioning exposure is measurable here; match repeated-effort dose/recovery needs later explicit policy and evidence |

With ordinary floor/standing space and high impact allowed, every capability has
at least one mapped candidate under both scenarios. This does **not** mean all
facets are achievable. In a small space without sideways clearance and with high
impact excluded, lateral work is unavailable in both scenarios. Bodyweight power
is also unavailable; the kit retains ballistic candidates subject to clearance,
technique and individual suitability. Empty equipment means bodyweight, not “all”.

## Constraints and editorial exclusions

Availability reuses canonical AND-of-OR equipment requirements, Main/Generator
flags, impact and supported `rounds`/`paired_sets` protocols. It returns per-ID
reasons and missing facets, alongside canonical difficulty, position, role,
family and planes. Space is reviewed policy context because the catalogue has no
intrinsic clearance field. `smallSpace` conservatively excludes lateral or
travelling mappings; ordinary mat/standing space still needs floor clearance,
arm sweep, TRX anchor room and safe ballistic/overhead clearance. Availability
is not medical or individual safety clearance, nor a guarantee of a fitting session.

- **Pallof press**: bands and a secure chest-height anchor; unilateral timed,
  supporting, low-impact anti-rotation control. Optional, never a compulsory
  band dependency. Dead bug/planks and DB pull-through offer non-band control.
- **Wood chop**: dumbbells, timed, low-impact supporting rotational control.
  Shoulder-to-hip arm/load clearance required. It does not earn explosive-power credit.
- **Skater jumps**: bodyweight, frontal plane, hard/high impact, sideways leaps
  and single-leg landings. The only reviewed lateral-braking mapping; no promise
  of court-speed deceleration proficiency. Exclude when impact/space is unsuitable.
- **Walking lunge, farmer carry and bear crawl** require travelling room and
  are not needed in this conservative mapping. Box jumps/step-ups require a safe
  platform; loaded/barbell lifts and technical overhead combinations are not
  automatically selected because a broad pattern looks useful. Exclusion from
  this mapping is not exclusion from the canonical catalogue or other programmes.
- Cossack/lateral lunges need lateral stance/step room; band lateral walks still
  need bands and room and do not substitute for landing/braking work.

## Reconciliation of all 13 recently added entries

| PR #86 exercise | Review outcome |
| --- | --- |
| Alternating lateral lunge | Lower-body and lateral-control mapping; not fast braking |
| Dumbbell reverse fly / TRX T fly | Shoulder support, with their existing supporting role |
| Dead bug | Trunk control; existing fixed-routine identity reused |
| Dumbbell / kettlebell sumo squat | Lower-body mapping; family/selection policy unchanged |
| TRX glute bridge | Lower-body mapping |
| Kettlebell suitcase deadlift | Available catalogue strength option; not required in conservative v1 mapping |
| Plank up-downs | Available catalogue option; not necessary beyond reviewed plank/control work |
| Kettlebell around-the-body pass | Hand-to-hand passing does not establish rotational power; omitted |
| Squat pulses | Existing supporting strength option; not ballistic power |
| Hammer curl / overhead triceps extension | Direct arm work remains available; not a shoulder-support substitute inferred from push/pull |

No duplicate lateral lunge, reverse fly, dead bug or Pallof/chop variants are added.
Possible later approval candidates: controlled lateral step-and-stick/braking
progression (low-impact alternative, still requires room); stationary bird dog
(bodyweight control variety); a controlled shoulder external-rotation movement
with an individually suitable DB setup. Rotational medicine-ball throws would
need new equipment, safe throwing space and technique review; not a small-garage
solution. Repeated-effort conditioning may need a reviewed shuttle/footwork drill
and explicit work/rest evidence rather than more generic resistance exercises.
These are candidates, not approved additions or promises of safe suitability.

Reproduce the detailed equipment/impact/space audit with
`node scripts/audit-tennis-capabilities.js`. No catalogue or Generator eligibility
changed, so the full reachability audit is not required for this issue.
