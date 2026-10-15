# Third-Party Notices

Dental Solutions redistributes third-party software. Every package listed below
ships under a permissive licence (MIT / ISC / Apache-2.0) that requires the
copyright notice and licence text to travel with the binary. This file is that
notice.

> **This file is not shipped yet.** It has to be added to `bundle.resources` in
> `src-tauri/tauri.conf.json` (e.g. `"resources": ["../THIRD_PARTY_NOTICES.md"]`)
> for the installer to actually carry it. That file is owned by another agent and
> was intentionally not edited here — **this step is still outstanding.**

## How this list was produced

Versions and licences were read from the installed `node_modules/<pkg>/package.json`
files, not from memory or from the npm registry, at the versions npm actually
resolved into `package-lock.json`. Re-run the audit whenever `dependencies`
changes — a stale notice is worse than none.

## Declared runtime dependencies

The full `dependencies` block of `package.json`. Three of these are build-time
tooling that is misfiled in `dependencies` and is **not** shipped in the
installer; they are marked accordingly below. `devDependencies` are excluded —
they are not redistributed.

| Package | Installed version | Licence | Shipped? |
| --- | --- | --- | --- |
| `@tauri-apps/api` | 2.12.0 | Apache-2.0 OR MIT | yes |
| `@tauri-apps/plugin-dialog` | 2.8.0 | MIT OR Apache-2.0 | yes |
| `lucide-react` | 0.546.0 | ISC | yes |
| `qrcode.react` | 4.2.0 | ISC | yes |
| `react` | 19.3.0 | MIT | yes |
| `react-dom` | 19.3.0 | MIT | yes |
| `recharts` | 3.10.1 | MIT | yes |
| `sql.js` | 1.13.0 | MIT | yes |
| `@tailwindcss/vite` | 4.3.3 | MIT | no — build plugin |
| `@vitejs/plugin-react` | 5.2.0 | MIT | no — build plugin |
| `vite` | 6.4.3 | MIT | no — build tool |

## Transitive packages bundled into the application

Resolved from the actual Rollup module graph of `src/main.tsx` (the contents of
`dist/assets`), not from a lockfile guess. These carry the same attribution
obligation as the direct dependencies above.

| Package | Installed version | Licence |
| --- | --- | --- |
| `@reduxjs/toolkit` | 2.12.0 | MIT |
| `clsx` | 2.1.1 | MIT |
| `d3-array` | 3.2.4 | ISC |
| `d3-color` | 3.1.0 | ISC |
| `d3-format` | 3.1.2 | ISC |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-path` | 3.1.0 | ISC |
| `d3-scale` | 4.0.2 | ISC |
| `d3-shape` | 3.2.0 | ISC |
| `d3-time` | 3.1.0 | ISC |
| `d3-time-format` | 4.1.0 | ISC |
| `decimal.js-light` | 2.5.1 | MIT |
| `es-toolkit` | 1.52.0 | MIT |
| `eventemitter3` | 5.0.4 | MIT |
| `immer` | 11.1.18 | MIT |
| `internmap` | 2.0.3 | ISC |
| `react-is` | 19.3.0 | MIT |
| `react-redux` | 9.3.0 | MIT |
| `redux` | 5.0.1 | MIT |
| `redux-thunk` | 3.1.0 | MIT |
| `reselect` | 5.2.0 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `tiny-invariant` | 1.3.3 | MIT |
| `use-sync-external-store` | 1.7.0 | MIT |
| `victory-vendor` | 37.3.6 | MIT AND ISC |

No `devDependency` reached the production bundle.

## Apache-2.0 notice

Applies to `@tauri-apps/api` and `@tauri-apps/plugin-dialog`. Both are offered
under `Apache-2.0 OR MIT`, so MIT could be elected instead and no Apache notice
would be owed. The Apache-2.0 notice is reproduced anyway because it is the
stricter of the two options and satisfies either choice.

`@tauri-apps/api`'s `LICENSE-APACHE-2.0` is the stock Apache 2.0 text and
carries no filled-in copyright line; the copyright for that package is asserted
in its MIT file and its SPDX metadata as:

```
Copyright (c) 2017 - Present Tauri Apps Contributors
```

`@tauri-apps/plugin-dialog` ships SPDX metadata only (`LICENSE.spdx`), which
states:

```
PackageSupplier: Organization: The Tauri Programme in the Commons Conservancy
PackageCopyrightText: 2019-2022, The Tauri Programme in the Commons Conservancy
```

```
Copyright 2017 - Present Tauri Apps Contributors
Copyright 2019-2022, The Tauri Programme in the Commons Conservancy

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

## Full licence texts

The complete licence text ships inside each package in the source distribution.
They are **not** uniformly placed, so the path differs per package:

- Most packages use a top-level `node_modules/<pkg>/LICENSE`
  (react, recharts, sql.js, lucide-react, qrcode.react, the `d3-*` family).
- `@tauri-apps/api` uses `LICENSE-APACHE-2.0` and `LICENSE-MIT`.
- `@tauri-apps/plugin-dialog` uses `LICENSE.spdx` (SPDX metadata, no full text).
- `victory-vendor` has no top-level licence file; its MIT terms are in its
  `README.md`/`package.json`, and the vendored d3 sources carry their own
  licences under `node_modules/victory-vendor/lib-vendor/<pkg>/LICENSE`.

Because those files are only present in the source distribution, an installed
build cannot reconstruct them from `node_modules`. Shipping this file alongside
the app is the part that makes the attribution obligation satisfiable.

## Scope note

This covers npm packages only. The Rust backend under `src-tauri/` has its own
set of crate licences that is out of scope for this file.