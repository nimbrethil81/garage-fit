# PickSetGo

[Open PickSetGo](https://nimbrethil81.github.io/garage-fit/) to choose a fixed workout,
generate one for your equipment or follow a Coach programme. Prep & Recover offers
five-minute warm-ups and cool-downs, and the Exercise Library explains each movement.

PickSetGo runs in your browser. History and settings stay on the device. Use Backup &
Restore to save a portable copy or move your data to another browser.

## Run locally

```sh
python3 scripts/preview_server.py --port 8000
```

Open <http://127.0.0.1:8000/>. The preview renders the same build diagnostic fields as
GitHub Pages, using the checkout's Git revision.

## Test and contribute

Use Node.js 22.1 or newer. Fast runs on pull requests to `main`. The manual
**PickSetGo Deep validation** workflow runs Full, the reachability audit, or both for a
selected revision. [Validation and delivery guidance](AGENTS.md#validation)

- [Exercise catalogue and metadata](data/EXERCISE_METADATA.md)
- [Coach engine](docs/COACH_ENGINE.md), [workout families](docs/WORKOUT_FAMILIES.md)
  and [workout protocols](docs/WORKOUT_PROTOCOLS.md)
- [Player layout and audio](docs/PLAYER_VIEWPORT.md)
- [Backup format and recovery](docs/BACKUP_FORMAT.md)
