# GarageFit native compatibility proof (#360)

Developer tooling only. This underscore directory is excluded by the existing
Pages/Jekyll default rules; no root package/build changes. Generated `www` and
`ios` are ignored. Do not deploy this as a production app.

Use Node 22+, Python 3.9+, a Mac capable of Xcode 26+, and an iPhone on iOS 15+.
Check the selected Xcode release's macOS and device-support requirements first.
No cloud builds, CocoaPods or paid tooling are required by this setup; Swift
Package Manager is used. Network access is needed to install tooling and resolve
native dependencies, not for the bundled training application.

From the repository root, with the desired committed application SHA:

```sh
npm ci --prefix _native-proof --ignore-scripts
python3 scripts/prepare_native.py --ref <FULL_SOURCE_SHA>
cd _native-proof
npm run ios:add -- --packagemanager SPM
npm run ios:sync
./node_modules/.bin/cap doctor ios
npm run ios:open
```

`ios:add` is for the first generation only. `prepare:web` is a convenience for
HEAD; it deliberately ignores uncommitted app edits. Never use a floating ref
when recording evidence. The generated `www/proof-manifest.json` records the
resolved commit and sorted file sizes/SHA-256 hashes. No timestamps or machine
paths affect output. Two Jekyll templates are rendered using the same revision
renderer as local previews; everything else is copied byte-for-byte from Git.
The allowlist includes the entire `assets`, `css`, `data`, `icons`, `js` trees,
not just HTML references, to include dynamic illustrations and ramp-up scripts.
Docs, tests, scripts, Git metadata and native tooling are excluded from the app.

In Xcode choose the existing local signing team, enable Developer Mode/trust on
the connected iPhone if required, select that physical device, and Run. Record
`sw_vers`, `xcodebuild -version`, `xcode-select -p`, the iPhone model/iOS, signing
team/bundle identity (no secrets), build number and manifest source SHA. Personal
Team provisioning may be suitable for local testing but has expiry and capability
limits; it does not establish distributable signing or store readiness.

The deliberately isolated identity is `dev.garagefit.compatibilityproof` and the
name is GarageFit Proof. It does not share Safari/PWA data. Default iOS URL is
expected to be `capacitor://localhost` from runtime source, **not measured on a
device**. No `server.url`, remote host, scheme override, plugins or native storage
adapter are configured. Do not change identity, hostname, scheme, signing team,
or WKWebsiteDataStore between upgrade tests; never uninstall between A and B.
Keep the generated project for that pair, increase its build number and install
over A using the same signing identity. Record both source SHAs and compare raw
saved results before/after; a regenerated clean install is not an upgrade test.

Browser-only checks (serve prepared output, not the raw Jekyll template):

```sh
python3 scripts/test_prepare_native.py
python3 -m http.server 8000 --bind 127.0.0.1 --directory _native-proof/www
# In another terminal:
python3 scripts/verify-native-bundle.py
python3 scripts/verify-backup.py /tmp/gf-native-backup http://127.0.0.1:8000
python3 scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/gf-native-player
```

Playwright and system Chromium are existing developer-only prerequisites. These
commands do not test WKWebView. See [findings and remaining gates](../docs/NATIVE_COMPATIBILITY_PROOF.md).
