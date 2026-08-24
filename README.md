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
