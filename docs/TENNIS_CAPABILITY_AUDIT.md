# Tennis capability mapping and catalogue gaps

`data/exercises.js` owns exercise identity and metadata; versioned mappings in
`data/sport-capabilities.js` own capability membership. Mapping is an explicit
editorial review, not inference from patterns/planes or evidence of improved tennis
performance. This document owns the conservative editorial limits and catalogue
gaps. [The Coach contract](COACH_ENGINE.md#sport-capability-coverage) owns the
coverage API and programme policy.

New Tennis v6 programmes use mapping v2; saved v1–v5 programmes retain mapping v1.
The table describes current mapping v2 unless a version is named.

## Coverage available now

The six capabilities have qualitative performed-exposure floors, not prescribed
physiological doses. Focus adds emphasis without removing Balanced coverage or
creating catch-up debt; mobility remains preparation, cooldown or targeted support.

| Capability | Bodyweight generated Main | DB/KB/TRX/pull-up kit adds | Limit |
| --- | --- | --- | --- |
| Lower-body (core) | Squat, reverse lunge, glute bridge, lateral lunge, Cossack squat | Loaded squats/hinges, TRX split squat/bridge, single-leg hinges | Strength/stability exposure, not lateral braking inferred from all lunges |
| Lateral movement/deceleration (core) | Lateral lunge/Cossack for home control; skater jumps for lateral landing/braking | KB lateral lunge adds home control; no reviewed low-impact braking alternative | Skaters are hard/high impact and need sideways landing space; controlled stepping is a different facet |
| Trunk (core) | Plank, side plank, dead bug for control | Plank pull-through/renegade row; wood chop, KB Russian twist, TRX power pull for rotation | Bodyweight generated rotation is underrepresented; fixed-only push-up rotation can classify performed work but is unavailable to Generator |
| Shoulder/upper body (core) | Push-up | Presses/rows/pull-ups; reverse fly, TRX T/Y fly, lateral raise for shoulder support | Bodyweight shoulder-support/pulling is underrepresented; general conditioning is not injury-prevention evidence |
| Explosive power (complementary) | Squat/skater jumps | Swings, clean, snatches, push press | No reviewed rotational-power exercise; transverse-plane chops/twists and the name “power pull” do not establish it |
| Match endurance/repeated efforts (complementary) | Climbers, jacks, high knees, burpees | Thruster, swing, TRX climber | Only general-conditioning exposure is measurable here; match repeated-effort dose/recovery needs later explicit policy and evidence |

Ordinary floor/standing space with high impact allowed provides candidates for all
six capabilities, without guaranteeing all facets. With high impact excluded,
bodyweight power is unavailable; the kit retains ballistic candidates subject to
clearance, technique and individual suitability. Empty equipment means bodyweight.
Mapping v1 excludes all lateral work in small space. Mapping v2 permits stationary
Cossack squats and single-step bodyweight/KB lateral lunges, returning to centre,
with comfortable stance/step clearance. Band walks and skater jumps still need
sideways clearance; home lateral control never establishes braking or court agility.

## Constraints and editorial exclusions

Availability reuses canonical AND-of-OR equipment requirements, Main/Generator
flags, impact and supported `rounds`/`paired_sets` protocols. It returns per-ID
reasons and missing facets, alongside canonical difficulty, position, role,
family and planes. Space is reviewed policy context because the catalogue has no
intrinsic clearance field. `smallSpace` excludes mappings marked as needing lateral or
travelling space; ordinary mat/standing space still needs floor clearance,
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

Other deliberate exclusions: suitcase deadlift and plank up-downs add no necessary
facet to this conservative mapping; around-the-body passing and squat pulses do
not establish explosive power. Direct curls/extensions are not shoulder-support
substitutes inferred from push/pull. Reverse lunge to knee drive earns lower-body
control only, not lateral or power credit. These exclusions do not restrict other
programmes or the canonical catalogue.

Unfilled facets need separate review and approval: low-impact lateral braking still
needs adequate room; controlled bodyweight rotation and shoulder-support/pulling
remain limited. Stationary control variety or suitable shoulder rotation may help,
but medicine-ball throws need new equipment, safe throwing space and technique
review. Match repeated-effort claims need explicit work/rest evidence rather than
more generic resistance exercises. These are gaps, not approved additions or
promises of individual suitability.

`node scripts/audit-tennis-capabilities.js` reproduces the saved mapping-v1
equipment/impact/space audit. For the current mapping-v2 home composition and v5/v6
comparison, use `node scripts/audit-tennis-movement.js`; the corresponding
`tests/sport-coverage.test.js` and `tests/tennis-policy.test.js` pin the versioned
constraints.
