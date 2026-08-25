// Documented workaround: Nimbalyst's host does not currently deliver extension
// `configuration` values to backend modules (utility-process runtime) through
// any of the surfaces probed in backend.ts's settingReader. Settings saved via
// the app's Settings UI land in the app's app-settings.json, but that file is
// otherwise invisible to this backend process. As a stopgap, we read the file
// directly and extract ONLY this extension's own settings key — never any
// other extension's configuration. Remove this module (and its use in
// backend.ts) once the platform ships settings delivery to backend modules.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reads `filePath` as JSON and returns the `configuration` object for
 * `extensionId` under `extensionSettings`. Returns `{}` on any error
 * (missing file, unreadable, malformed JSON, or missing keys) — this is a
 * best-effort read, never a source of truth failures.
 */
export function readExtensionConfigurationFromFile(
  filePath: string,
  extensionId: string,
): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const configuration = parsed?.extensionSettings?.[extensionId]?.configuration;
    if (configuration && typeof configuration === 'object' && !Array.isArray(configuration)) {
      return configuration as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Platform-aware candidate paths for Nimbalyst's app-settings.json, in
 * linux, windows, macOS order. All three are returned regardless of the
 * current platform so callers can probe deterministically (e.g. in tests).
 */
export function appSettingsCandidatePaths(): string[] {
  const home = homedir();
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  return [
    join(home, '.config', '@nimbalyst', 'electron', 'app-settings.json'),
    join(appData, '@nimbalyst', 'electron', 'app-settings.json'),
    join(home, 'Library', 'Application Support', '@nimbalyst', 'electron', 'app-settings.json'),
  ];
}

/**
 * Returns the first non-empty configuration object for `extensionId` found
 * across the candidate app-settings.json paths, or `{}` if none match.
 */
export function readAppSettingsConfiguration(extensionId: string): Record<string, unknown> {
  for (const path of appSettingsCandidatePaths()) {
    const config = readExtensionConfigurationFromFile(path, extensionId);
    if (Object.keys(config).length > 0) return config;
  }
  return {};
}
