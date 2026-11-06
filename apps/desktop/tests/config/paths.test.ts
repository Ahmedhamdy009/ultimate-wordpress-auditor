import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { PROJECT_ROOT, DESKTOP_STORAGE_PATHS } from '../../src/main/config/paths.js';

describe('Desktop Main Path Configuration & Character Encoding Verification', () => {
  const BACKSLASH = String.fromCharCode(92);
  const DOUBLE_BACKSLASH = String.fromCharCode(92, 92);

  const expectedRootChars = ['D', ':', BACKSLASH, 'a', 'h', 'm', 'e', 'd'];
  const expectedRootString = expectedRootChars.join('');
  const expectedRootCodes = [68, 58, 92, 97, 104, 109, 101, 100];

  const expectedTmpChars = [...expectedRootChars, BACKSLASH, '.', 't', 'm', 'p'];
  const expectedTmpString = expectedTmpChars.join('');
  const expectedTmpCodes = [68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112];

  const expectedUserDataChars = [
    ...expectedTmpChars,
    BACKSLASH,
    'u',
    's',
    'e',
    'r',
    'D',
    'a',
    't',
    'a',
  ];
  const expectedUserDataString = expectedUserDataChars.join('');
  const expectedUserDataCodes = [
    68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112, 92, 117, 115, 101, 114, 68, 97, 116,
    97,
  ];

  const expectedSessionDataChars = [
    ...expectedTmpChars,
    BACKSLASH,
    's',
    'e',
    's',
    's',
    'i',
    'o',
    'n',
    'D',
    'a',
    't',
    'a',
  ];
  const expectedSessionDataString = expectedSessionDataChars.join('');
  const expectedSessionDataCodes = [
    68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112, 92, 115, 101, 115, 115, 105, 111,
    110, 68, 97, 116, 97,
  ];

  it('enforces exact PROJECT_ROOT runtime string and character codes without ambiguous literals', () => {
    // 1. Independent string equality against character array assembly
    expect(PROJECT_ROOT).toBe(expectedRootString);
    expect(DESKTOP_STORAGE_PATHS.projectRoot).toBe(expectedRootString);

    // 2. Exact runtime length
    expect(PROJECT_ROOT.length).toBe(8);

    // 3. Exact character-code comparison
    const actualCodes = Array.from(PROJECT_ROOT).map(char => char.charCodeAt(0));
    expect(actualCodes).toEqual(expectedRootCodes);

    // 4. Exactly one backslash at index 2
    expect(PROJECT_ROOT.indexOf(BACKSLASH)).toBe(2);
    expect(PROJECT_ROOT.lastIndexOf(BACKSLASH)).toBe(2);

    // 5. No consecutive duplicated backslashes exist in runtime path
    expect(PROJECT_ROOT.includes(DOUBLE_BACKSLASH)).toBe(false);
  });

  it('enforces exact storage directory paths without duplicate backslashes', () => {
    // tmpDir
    expect(DESKTOP_STORAGE_PATHS.tmpDir).toBe(expectedTmpString);
    expect(DESKTOP_STORAGE_PATHS.tmpDir.length).toBe(13);
    expect(Array.from(DESKTOP_STORAGE_PATHS.tmpDir).map(c => c.charCodeAt(0))).toEqual(
      expectedTmpCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.tmpDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // userDataDir
    expect(DESKTOP_STORAGE_PATHS.userDataDir).toBe(expectedUserDataString);
    expect(DESKTOP_STORAGE_PATHS.userDataDir.length).toBe(22);
    expect(Array.from(DESKTOP_STORAGE_PATHS.userDataDir).map(c => c.charCodeAt(0))).toEqual(
      expectedUserDataCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.userDataDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // sessionDataDir
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir).toBe(expectedSessionDataString);
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir.length).toBe(25);
    expect(Array.from(DESKTOP_STORAGE_PATHS.sessionDataDir).map(c => c.charCodeAt(0))).toEqual(
      expectedSessionDataCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // All directories resolve cleanly via path.win32.normalize with 0 changes
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.tmpDir)).toBe(expectedTmpString);
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.userDataDir)).toBe(expectedUserDataString);
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.sessionDataDir)).toBe(
      expectedSessionDataString,
    );
  });
});
