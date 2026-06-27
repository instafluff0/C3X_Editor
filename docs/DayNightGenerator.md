# Day-Night Generator

## Purpose

The editor can generate C3X day-night and seasonal PCX cycles from noon source art. The app runtime must remain portable JavaScript: no Python, Pillow, shell scripts, or external C3X_Districts checkout may be required for normal generation, preview, scanning, or packaged app behavior.

Upstream `../C3X_Districts/DayNight/generate.sh` is still the visual oracle for default output during development. Treat it as a parity reference, not as a production dependency.

## Runtime Ownership

- Main generator module: `src/dayNightGenerator.js`
- Worker entrypoint: `src/operationWorker.js`
- IPC surface: `main.js` and `preload.js`
- Renderer entrypoints live in `src/renderer.js`, but generator semantics belong in `src/dayNightGenerator.js`.
- PCX decoding and encoding should use the repo JavaScript PCX helpers in `src/artPreview.js`.

Do not add runtime calls to `generate.sh`, Python, Pillow, ImageMagick, or external helper binaries. Do not add vendored Python day-night tools to package metadata.

## Input Layout

Terrain source art:

```text
Art/DayNight/<Season>/1200/*.pcx
Art/DayNight/<Season>/Annotations/*_lights.pcx
Art/DayNight/Summer/Annotations/*_lights.pcx
```

District source art:

```text
Art/Districts/<Season>/1200/*.pcx
Art/Districts/<Season>/Annotations/*_lights.pcx
Art/Districts/Summer/Annotations/*_lights.pcx
```

`Summer/Annotations` is the fallback annotation source. Season-specific annotations win when present. Generation copies applicable annotation layers into the season `1200` folder for processing and removes generated or copied `_lights.pcx` files after the run, matching the upstream script cleanup behavior.

If `enable_districts = false`, district scans and district generation must be ignored. Terrain generation remains valid.

## Output Hours

The generated non-noon hour folders are:

```text
0100 0200 0300 0400 0500 0600 0700 0800 0900 1000 1100
1300 1400 1500 1600 1700 1800 1900 2000 2100 2200 2300 2400
```

`1200` is source input and should not be overwritten as a generated output hour.

## Source-Art Seeding

When a scenario lacks custom day-night source art, seeding may copy existing C3X-ready fallback art into the resolved scenario art target. It must:

- write only inside scenario-allowed roots,
- avoid overwriting existing user files,
- never modify base game or C3X fallback art,
- copy source layouts as C3X day-night source layouts, not silently reinterpret arbitrary Civ3 art into day-night-ready files.

## Annotation Drafting

Experimental light annotation drafting lives in `src/dayNightAnnotationDraft.js`. It is a portable JavaScript helper for creating an initial `*_lights.pcx` from source PCX art, not a replacement for human-authored annotations.

The helper must preserve indexed-PCX semantics:

- reserve the generator light-key colors immediately before the final two Civ3 transparent slots,
- keep the final palette slots as green and magenta transparency colors,
- displace source colors from reserved light-key slots using low-use palette entries and nearby pixel sampling,
- never place drafted lights on green or magenta magic background,
- currently auto-place only the orange and yellow light keys, while still reserving every generator light-key slot for later manual or automated use.

## Parity Contract

The JavaScript pipeline should track upstream defaults as closely as possible. When porting or changing generator behavior, compare against `generate.sh` for:

- hour labels and stage ordering,
- season setup and Summer fallback copies,
- annotation copy-in and `_lights.pcx` cleanup,
- day-night tinting, saturation, contrast, noon blending, green-to-magenta remap, and blackened green palette handling,
- protected pixel handling,
- city-light style parsing, mask construction, blur behavior, alpha scaling, blend behavior, magic-color preservation, and night-only plain-file replacement,
- postprocess green removal and matching-file selection.

Default option values in `SCRIPT_DEFAULTS` should match upstream script constants. If upstream changes, update the JS defaults and parity evidence together.

One upstream quirk is intentional: `generate.sh` passes `highlight_gain` inside `LIGHT_STYLES`, but `civ3_city_lights.py` only parses per-key `highlight`. Keep the JavaScript parser aligned with that behavior unless the upstream script changes, otherwise yellow/orange light regions become visibly too hot and fail parity.

## Tests

Normal fast tests must stay JavaScript-only and portable. They should cover:

- toolchain inspection reports portable JavaScript,
- seasonal fixture scans for annotated files, Summer-fallback annotations, and files with no annotations,
- disabled districts suppress district scan and generation,
- all non-noon output hours are generated,
- repeat JS runs are byte-deterministic,
- preview returns valid RGBA.

Portable day-night and season generation tests live in their own runner tier:

```bash
npm run test:day-night
```

The default fast tier excludes those generator tests so normal config/UI checks stay quick. `npm run test:full` includes them. The dev-only parity harness remains explicit because it may depend on upstream `generate.sh`, Python, and Pillow.

The dev-only parity harness is `test/dayNightParity.devtest.js`. It may invoke upstream `generate.sh` and Python/Pillow only when available. It should skip for missing upstream tooling, compare JS output against upstream output across selected seasonal fixtures, and emit diff artifacts when thresholds fail. Keep both annotated files and no-annotation terrain files in this matrix so the city-light and plain day-night paths stay covered.

Run the parity harness explicitly:

```bash
node --test test/dayNightParity.devtest.js
```

`npm test` should not depend on external C3X_Districts tooling.
