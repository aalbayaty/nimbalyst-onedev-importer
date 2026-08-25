# OneDev Issues Importer for Nimbalyst

Adds OneDev as a provider in Nimbalyst's Trackers tab: browse and import
issues from a self-hosted OneDev server as native tracker items that link
back to their source.

## Setup

1. Create an access token on your OneDev server (user menu → Access Tokens).
2. In Nimbalyst: Settings → OneDev Importer → set **Server URL** and
   **API Token**. Leave **Username** empty to use Bearer auth; set it to use
   HTTP Basic (`username:token`) on older servers.
3. Optional: set **Project** per workspace to skip git-remote detection, and
   **Open states** if your server's workflow renames/extends "Open".

Env fallbacks (useful for headless setups): `ONEDEV_URL`, `ONEDEV_TOKEN`,
`ONEDEV_USERNAME`.

**Known limitation:** Nimbalyst's host does not yet deliver `configuration`
values to backend modules (the utility-process runtime this extension's
importer logic runs in). As a workaround, the backend reads its own settings
directly from Nimbalyst's `app-settings.json` on disk (see
`src/appSettingsFile.ts`); it never reads any other extension's settings.
This is transparent to normal use — Settings UI values still apply, and
changes take effect without a backend restart — but it will be removed once
the platform ships settings delivery to backend modules. The env vars above
remain a fallback on top of it.

## Development

```bash
npm install
npm test          # vitest unit tests (pure client + HTTP layer)
npm run build     # emits dist/index.js and dist/backend.js
```

Iterate from inside Nimbalyst with the Extension Dev Kit
(`extension_build` / `extension_install` / `extension_reload`).

## Not in v1

Two-way sync, pull-request import, OS-keychain token storage.
