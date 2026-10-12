# Packaging Blisspoint for StartOS and Umbrel

This document is the standing reference for packaging and shipping Blisspoint to
StartOS and Umbrel. Read it before any packaging work. It exists so nobody has to
re-derive the two platform structures from scratch on every release.

Sources of truth (verified 2026-10-12):

- StartOS packaging guide: <https://docs.start9.com/packaging/0.4.0.x/>
- StartOS project structure: <https://docs.start9.com/packaging/0.4.0.x/reference/project-structure.html>
- StartOS recipes (agent-facing): <https://docs.start9.com/packaging/0.4.0.x/recipes.html>
- Umbrel App Store README: <https://github.com/getumbrel/umbrel-apps#readme>
- Umbrel packaging skill: <https://github.com/getumbrel/umbrel-apps/blob/master/.agents/skills/umbrel-package-app/SKILL.md>
  (local copy: `docs/reference/umbrel-package-app-SKILL.md`)
- SDK 3 reference packages: [Start9-Community/thunderhub-startos](https://github.com/Start9-Community/thunderhub-startos)
  (prebuilt-image case — closest to ours), [Start9-Community/electrs-startos](https://github.com/Start9-Community/electrs-startos)
  (submodule + patches case — not ours)

---

## 1. The two platforms at a glance

| | StartOS | Umbrel |
|---|---|---|
| Package format | `.s9pk` built from a TypeScript SDK package | Plain directory: `umbrel-app.yml` + `docker-compose.yml` |
| Where the package lives | Its own repo (`*-startos`), separate from the app repo | Top-level dir in a store repo; we mirror from this repo's `umbrel/` |
| App source | Published Docker image pinned by tag in the manifest | Published Docker image pinned by tag **and** sha256 digest in compose |
| Architectures | `x86_64` + `aarch64` (declared in manifest) | `linux/amd64` + `linux/arm64` (verified on the image manifest list) |
| Build tooling | Node + npm, `start-cli s9pk pack` (Makefile includes SDK's `s9pk.mk`) | None — YAML authoring + `docker buildx imagetools inspect` for the digest |
| CI | 5 reusable workflows delegating to Start9Labs/start-technologies | Store-side linter on PR (`npm run lint:apps -- <app-id> --check-images`) |
| Runtime contract | SDK daemons, health checks, volumes, interfaces | Docker compose; `app_proxy` routes `port` to `APP_PORT` on the web service |

Both platforms consume the **same published image**: `ghcr.io/heatpunk/blisspoint:<version>`,
built multi-arch by this repo's `release.yml` on tag push. One image, two wrappers.

---

## 2. The app repo (heatpunk/blisspoint) — image production

The app repo's only packaging job is producing a correct multi-arch image and
versioning it. Everything else reads that image.

### Release flow (existing, `.github/workflows/release.yml`)

1. Tag `vX.Y.Z` (or manual `workflow_dispatch` with version input).
2. `docker` job: buildx builds `linux/amd64,linux/arm64` from the root
   `Dockerfile` (rust:alpine proxy-rs stage + node:20 UI stage), pushes
   `ghcr.io/heatpunk/blisspoint:X.Y.Z` plus semver tags.
3. `s9pk` job: packs a legacy SDK 2 s9pk from `sdk-build/` — **this job dies when
   the StartOS package moves to its own repo.**

### The ARM rule (why v0.6.0 broke, and the standing constraint)

v0.6.0's tag was pushed to GHCR by a manual `docker push` from a machine, outside
every CI job, and that push carried only `linux/amd64`. Everyone on ARM who pulled
the tag got a broken image. Start9's maintainers patched around it; our pipeline
must make it impossible to repeat.

**Standing rule: the only writer of `ghcr.io/heatpunk/blisspoint:*` version tags
is the release.yml docker job, which always builds both platforms.** Never push a
version tag by hand. If you need a test image, use a non-version tag.

Verification before declaring a release good (both platforms depend on this):

```bash
docker buildx imagetools inspect ghcr.io/heatpunk/blisspoint:X.Y.Z
# Must list BOTH linux/amd64 and linux/arm64. If either is missing, the release is broken.
```

### Version bump checklist (app repo)

1. Bump `version` in `package.json`.
2. Tag `vX.Y.Z` and push the tag.
3. Wait for the release workflow; verify the image manifest list (command above).
4. Then update the two packaging targets (sections 3 and 4).

---

## 3. StartOS package — new repo `blisspoint-startos` (SDK 3)

The StartOS maintainers' ask (issue
[Start9-Community/blisspoint#5](https://github.com/Start9-Community/blisspoint/issues/5)):
the package must live in its own repo in the **standard package layout**, on the
**new SDK (3.x)**, with the app consumed as a published image. The in-app
`startos/` + `sdk-build/` (SDK 2.0.6) setup blocked their SDK 3 migration and is
what kept the package pinned to an old packaging version in their Marketplace.

### 3.1 Why a separate repo (the docs' rule)

A package repo holds packaging only — `startos/`, manifest, docs, CI. The
application comes from one of three sources: a published upstream image (default,
ours), a git submodule built by the package's Dockerfile, or a Start9-built
image. Copying the app source into the package repo is explicitly **not** an
option: it turns every upstream release into a hand-merge and breaks the
standard-layout property ("a tool that knows one package knows all of them").

### 3.2 Required repository layout (SDK 3)

```text
blisspoint-startos/
├── .github/workflows/
│   ├── build.yml          # PR build → Start9Labs/start-technologies/.github/workflows/build.yml@master
│   ├── pr-retarget.yml    # rebuild when a PR's base changes
│   ├── tagAndRelease.yml  # merge to master → version check → tag → build → release → publish
│   ├── release.yml        # manual tag push → build → release → publish
│   └── syncNext.yml       # carry master onto `next` on merge
├── assets/                # required, may be empty (.gitkeep)
├── startos/
│   ├── actions/           # user-facing action scripts (empty is fine initially)
│   ├── i18n/
│   │   ├── index.ts
│   │   └── dictionaries/{default.ts, translations.ts}
│   ├── init/              # container init logic
│   ├── manifest/
│   │   ├── index.ts       # setupManifest({...})
│   │   └── i18n.ts
│   ├── backups.ts         # sdk.setupBackups — volumes 'main'
│   ├── dependencies.ts    # sdk.setupDependencies — {} for us
│   ├── index.ts           # boilerplate exports
│   ├── interfaces.ts      # Web UI interface (port 80, http)
│   ├── main.ts            # daemon: subcontainer from image 'blisspoint', proxy-rs + serve.cjs
│   ├── sdk.ts             # StartSdk.of().withManifest(manifest).build(true)
│   ├── utils.ts           # uiPort = 80, paths
│   └── versions/          # version graph; current + all prior versions with migrations
├── .dockerignore          # keeps node_modules/.git/*.s9pk out of the build context
├── .gitignore
├── AGENTS.md              # repo identity + how to work in this repo (agent context)
├── CLAUDE.md              # one line: @AGENTS.md
├── icon.svg               # service icon, max 40 KiB
├── instructions.md        # post-install instructions packed into the s9pk
├── LICENSE                # MIT (mirror of app repo)
├── Makefile               # see 3.4
├── package.json           # only dependency: @start9labs/start-sdk
├── package-lock.json
├── .prettierrc            # one line, see 3.4
├── README.md              # service docs
├── tsconfig.json          # extends @start9labs/start-sdk/tsconfig.base.json
└── UPDATING.md            # per-package upstream version tracking (which image, which tag)
```

The existing `startos/` in this repo is already close to this shape — the main
work is the SDK 2 → 3 migration and dropping the `sdk-build/` ncc mechanism.

### 3.3 Manifest (verified against thunderhub-startos, SDK 3.0.3)

```ts
import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'blisspoint',
  title: 'Blisspoint',
  license: 'MIT',
  packageRepo: 'https://github.com/Start9-Community/blisspoint-startos',
  upstreamRepo: 'https://github.com/heatpunk/blisspoint',
  marketingUrl: 'https://github.com/heatpunk/blisspoint',
  donationUrl: null,
  description: { short, long },
  volumes: ['main'],
  images: {
    blisspoint: {
      source: { dockerTag: 'ghcr.io/heatpunk/blisspoint:X.Y.Z' },
      arch: ['x86_64', 'aarch64'],
      emulateMissing: false,
    },
  },
})
```

Key differences from our SDK 2 manifest: `emulateMissing: false` appears on
images, and the `source` is just the published tag (StartOS pulls at install).
`main.ts`, `interfaces.ts`, `backups.ts` port over almost unchanged — thunderhub's
SDK 3 daemon/subcontainer shape matches our current code (SubContainer from
`imageId`, `sdk.useEntrypoint()` replaces our explicit `sh -c` command when the
image has a proper entrypoint; our image uses a shell CMD, so keep the explicit
command or fix the image CMD first).

### 3.4 Boilerplate file contents (copy exactly from the reference packages)

`Makefile`:
```make
ARCHES := x86 arm
# overrides to s9pk.mk must precede the include statement
include node_modules/@start9labs/start-sdk/s9pk.mk
```

`package.json`:
```json
{
  "name": "blisspoint-startos",
  "dependencies": {
    "@start9labs/start-sdk": "^3.0.6"
  },
  "overrides": {
    "@start9labs/start-sdk": "$@start9labs/start-sdk"
  }
}
```
(SDK 3.0.6 is the latest npm release as of 2026-10-12. The override line pins
transitive deps to the same SDK version.)

`.prettierrc`:
```
"@start9labs/start-sdk/prettier.config.json"
```

`tsconfig.json`:
```json
{
  "extends": "@start9labs/start-sdk/tsconfig.base.json",
  "include": ["startos/**/*.ts", "node_modules/**/startos"]
}
```

### 3.5 CI: reusable workflows, not hand-rolled

All five workflows delegate to `Start9Labs/start-technologies` reusable
workflows. Do not copy the app repo's hand-rolled release.yml — the StartOS
pipeline does version-check → tag → multi-arch build → release → publish and
signs with a `DEV_KEY`. `tagAndRelease.yml` and `release.yml` reference repo
variables/secrets (`REFERENCE_REGISTRY`, `RELEASE_REGISTRY`, `S3_S9PKS_BASE_URL`,
`DEV_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) that **Start9 configures on their
side once the repo exists in their org.** We provide the workflow files; the
secrets are theirs to set.

### 3.6 Version semantics

Package versions look like `X.Y.Z:N` where `N` is the packaging revision for the
same upstream version. Every new upstream release = bump `X.Y.Z` in
`startos/versions/current.ts` (and add the old entry to the version graph if a
data migration is needed — for Blisspoint, migrations have been no-ops so far).
`releaseNotes.en_US` is user-facing changelog text shown in StartOS.

### 3.7 Local build & test

```bash
npm install
make   # runs s9pk pack via s9pk.mk → blisspoint.s9pk
start-cli s9pk inspect blisspoint.s9pk manifest   # sanity-check the manifest
# Install on a StartOS dev VM / sideload via the StartOS UI to test.
```

### 3.8 Update checklist (StartOS, per app release)

1. Confirm the new image exists and is multi-arch (section 2 verification).
2. In `blisspoint-startos`: bump `versions/current.ts` version + release notes,
   bump `dockerTag` in `manifest/index.ts`, update `UPDATING.md`.
3. PR to `master` → `build.yml` must pass (that is the compile gate).
4. Merge → `tagAndRelease.yml` tags, builds, releases, publishes.
5. The package then flows to the Start9 registry per their publishing config.

---

## 4. Umbrel — community store now, official store PR open

### 4.1 The two Umbrel targets

- **Official store** (`getumbrel/umbrel-apps`): the PR is
  [getumbrel/umbrel-apps#5833](https://github.com/getumbrel/umbrel-apps/pull/5833)
  (branch `heatpunk:add-hashboard`, opened as "Hashboard" — the pre-rename name).
  One top-level `blisspoint/` dir per app. Maintainer `nmfretz` left review
  feedback (ARM64 test blockers) — check current state before touching it.
- **Community store** (`heatpunk/umbrel-app-store`): what users install today.
  Its `blisspoint/` mirrors this repo's `umbrel/blisspoint/` on each release
  (README: "The app definitions here mirror umbrel/ in the main repo and are
  updated on each release").

### 4.2 Package structure (both targets)

```text
blisspoint/
├── umbrel-app.yml       # manifest: manifestVersion 1, id, category, name, version,
│                        #   tagline, description, releaseNotes, developer, website,
│                        #   dependencies, repo, support, port, gallery, path,
│                        #   defaultUsername/Password, submitter, submission
└── docker-compose.yml   # app_proxy (APP_HOST: blisspoint_web_1, APP_PORT: 80) + web service
```

Field-order contract for new packages (from the official skill):
`manifestVersion, id, storage, category, name, version, tagline, description,
releaseNotes, developer, website, dependencies, repo, support, port, gallery,
path, defaultUsername, defaultPassword, submitter, submission`.

Differences official-store vs community-store manifests:

| Field | Official store | Community store (ours today) |
|---|---|---|
| `icon` | omit — Umbrel hosts assets separately | keep (URL to raw.githubusercontent icon) |
| `gallery` | `[]` — Umbrel team adds images before merge | may list screenshots |
| `storage` | add `storage: { dataRoot: data }` (umbrelOS 2.0 external-drive support; once added it can't be removed) | optional |
| `submission` | the PR URL | n/a |

### 4.3 Image pinning rule (the #1 source of review failures)

Both compose targets must pin **tag + multi-arch index digest**:

```yaml
image: ghcr.io/heatpunk/blisspoint:0.6.0@sha256:<INDEX-digest>
```

Get the digest with:

```bash
docker buildx imagetools inspect ghcr.io/heatpunk/blisspoint:0.6.0
```

- Use the **manifest-list/index digest** (the one the inspect header shows), not
  a per-arch digest — a per-arch digest installs on one platform only, which is
  exactly the class of bug that blocked PR #5833 once already (0.5.2 was
  single-platform amd64).
- Confirm `linux/amd64` **and** `linux/arm64` both appear in the manifest list.
- Never `latest`. Never digest-only.

### 4.4 Ports and proxy wiring

- Manifest `port: 3847` = the host-facing port Umbrel opens (via app_proxy).
- Compose `app_proxy.environment.APP_PORT: 80` = the container's internal listen
  port. Our container serves the UI on 80 (`serve.cjs`) and proxies `/api/*` to
  proxy-rs on 8081.
- No raw `ports:` on the web service; no `network_mode: host` — the default
  bridge allows outbound LAN, which is all the miner communication needs
  (asic-rs talks to miners on the LAN, e.g. port 4028).

### 4.5 Update checklist (Umbrel, per app release)

1. Verify image multi-arch (section 2).
2. Get the new index digest (`docker buildx imagetools inspect`).
3. `umbrel/blisspoint/umbrel-app.yml`: bump `version`, update `releaseNotes`
   (folded YAML `>-`, blank line between paragraphs).
4. `umbrel/blisspoint/docker-compose.yml`: bump tag and digest.
5. Commit, then mirror both files to `heatpunk/umbrel-app-store/blisspoint/`
   (keep `icon` there; keep `gallery`/`submission` per target).
6. Official store: update PR #5833's files the same way **only after** addressing
   the maintainer's review blockers — read the PR conversation first.
7. Lint (official store): `npm run lint:apps -- blisspoint --check-images`.

---

## 5. Release-day runbook (both platforms, in order)

1. **App repo**: bump `package.json` version → tag `vX.Y.Z` → push tag.
2. Wait for `release.yml`; verify `docker buildx imagetools inspect` shows
   `linux/amd64` + `linux/arm64`. Stop here if not — everything downstream is
   broken until this is true.
3. **StartOS repo** (`blisspoint-startos`): manifest `dockerTag` + `current.ts`
   version + release notes + `UPDATING.md` → PR → merge (CI publishes).
4. **Umbrel**: `umbrel-app.yml` version + releaseNotes; `docker-compose.yml` tag +
   new index digest → commit → mirror to `heatpunk/umbrel-app-store`.
5. Announce: app repo GitHub release notes cover the app; StartOS release notes
   live in `current.ts`; Umbrel releaseNotes live in `umbrel-app.yml`.

---

## 6. Known open items

- [ ] `blisspoint-startos` repo does not exist yet (issue #5 asks for it in
      Start9-Community; decide who creates it — write access to that org required).
- [ ] SDK 2 → 3 migration of `startos/` (small: manifest shape, Makefile,
      package.json, tsconfig, drop `sdk-build/`).
- [ ] StartOS CI needs Start9-side secrets (`DEV_KEY`, S3, registry vars) once
      the repo is in their org.
- [ ] Our image CMD is `sh -c 'proxy-rs & node server/serve.cjs'` — SDK 3
      `sdk.useEntrypoint()` would be cleaner; either keep the explicit exec
      command in `main.ts` or give the image a real entrypoint first.
- [ ] PR #5833 (official Umbrel store) has open maintainer feedback (ARM64
      first-run blockers) — resolve before mirroring new versions there.
- [ ] The legacy `s9pk` job in this repo's `release.yml` should be removed when
      `blisspoint-startos` takes over packaging.
