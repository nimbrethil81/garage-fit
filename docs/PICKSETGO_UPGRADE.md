# PickSetGo in-place upgrade and rollback (#376)

Keep hosting at `https://nimbrethil81.github.io/garage-fit/`. The manifest's
`id`, `start_url` and `scope` stay `./`; icons, all `gf_*` storage keys,
`garagefit-data-use-v1` lock, restore journal/reserve and internal APIs retain
their identities. There is no data migration or service-worker change.

## Before live deployment

- Keep this change undeployed until the existing physical iPhone installation
  gate below has been completed on a controlled candidate update. Do not merge
  into an automatically deployed branch to bypass this gate.
- Retain the pre-rebrand commit and its build assets for rollback. Compare
  synthetic populated storage across the old and new builds at one origin;
  equipment/settings, recency, first-use, programme and performed history must
  retain their exact values. Existing draft/recovery protections must pass.
- Run the focused tests, Fast and Full suites, `scripts/verify-backup.py` and
  `scripts/verify-rebrand.py` (the latter needs previews of both builds, as
  described in its header). These are developer-only synthetic fixtures.
- Coordinate with #375: its frozen Settings/About/Help copy already specifies
  PickSetGo. Preserve that copy and diagnostics semantics when it lands.

## Existing physical iPhone installation — unverified in the coding environment

1. Use the existing installation at the original origin. Record its build,
   Home Screen label, equipment, preferences, first-use state, programme and
   workout/progress history. Finish active workouts first. Do not clear site
   data, remove the Home Screen app or reinstall it.
2. Apply the candidate update through the controlled rollout path, reopen the
   existing app and confirm the loaded build revision. Check all five mastheads,
   light/dark appearance, navigation, history and programme continuity.
3. Record whether iOS changes the existing Home Screen label automatically.
   A cached label is a platform limitation to report; it does not justify
   changing manifest identity or deleting the installation.
4. Create a **new PickSetGo backup after updating**, save it, reselect it and
   verify it. Check restore using synthetic data in a separate test browser;
   do not overwrite the user's live history to test restoration.
5. Check browser title and a fresh test installation separately. Only consider
   an optional reinstall after the new backup is saved and verified and the
   user chooses to proceed. Never use uninstalling as an upgrade test.

## Rollback

- If data/history differs or recovery is unresolved, stop rollout. Close other
  tabs; retain existing site storage and any restore journal/reserve. Do not
  clear data or weaken recovery checks.
- Revert to the retained pre-rebrand build at the **same origin and paths**.
  With no schema/key changes, existing live records remain the rollback source;
  verify the loaded revision and history again.
- Backup archives have strict brand identity: new archives use `app: "PickSetGo"`
  and `PickSetGo-backup-YYYY-MM-DD.json`. Historic GarageFit archives are not an
  assured restore path in PickSetGo; conversely, the old build does not accept
  new PickSetGo archives. Do not edit an archive to force it through validation.
- Keep the new verified archive safe and resolve any recovery problem before
  resuming training or considering a reinstall.
