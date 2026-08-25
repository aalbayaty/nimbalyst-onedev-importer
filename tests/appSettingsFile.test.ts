import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readExtensionConfigurationFromFile,
  appSettingsCandidatePaths,
} from '../src/appSettingsFile';

const EXTENSION_ID = 'com.nimbalyst-community.onedev-importer';

let tmpDir: string | null = null;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onedev-importer-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('readExtensionConfigurationFromFile', () => {
  it('reads the configuration object for the extension id from a well-formed file', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'app-settings.json');
    fs.writeFileSync(file, JSON.stringify({
      extensionSettings: {
        [EXTENSION_ID]: {
          configuration: { serverUrl: 'https://onedev.example.com', apiToken: 'secret' },
        },
        'some.other.extension': {
          configuration: { unrelated: 'value' },
        },
      },
    }));

    const result = readExtensionConfigurationFromFile(file, EXTENSION_ID);

    expect(result).toEqual({ serverUrl: 'https://onedev.example.com', apiToken: 'secret' });
  });

  it('returns {} for a missing file', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'does-not-exist.json');

    expect(readExtensionConfigurationFromFile(file, EXTENSION_ID)).toEqual({});
  });

  it('returns {} for malformed JSON', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'app-settings.json');
    fs.writeFileSync(file, '{ not valid json');

    expect(readExtensionConfigurationFromFile(file, EXTENSION_ID)).toEqual({});
  });

  it('returns {} when the extensionSettings key is missing', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'app-settings.json');
    fs.writeFileSync(file, JSON.stringify({ somethingElse: true }));

    expect(readExtensionConfigurationFromFile(file, EXTENSION_ID)).toEqual({});
  });

  it('returns {} when the extension id has no entry', () => {
    const dir = makeTmpDir();
    const file = path.join(dir, 'app-settings.json');
    fs.writeFileSync(file, JSON.stringify({
      extensionSettings: { 'some.other.extension': { configuration: { a: 1 } } },
    }));

    expect(readExtensionConfigurationFromFile(file, EXTENSION_ID)).toEqual({});
  });
});

describe('appSettingsCandidatePaths', () => {
  it('returns 3 absolute paths ending in app-settings.json', () => {
    const candidates = appSettingsCandidatePaths();

    expect(candidates).toHaveLength(3);
    for (const candidate of candidates) {
      expect(path.isAbsolute(candidate)).toBe(true);
      expect(candidate.endsWith('app-settings.json')).toBe(true);
    }
  });
});
