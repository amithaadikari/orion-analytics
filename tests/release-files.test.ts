import { describe, expect, it } from 'vitest';
import {
  isSafeReleaseStoragePath,
  normalizedReleaseContentType,
  releaseFileExtension,
  releaseStoragePath,
  releaseUploadMaxBytes,
  safeReleaseFileName,
  validateReleaseFileMetadata,
  type ReleasePlatform,
} from '@/lib/release-files';

const releaseId = '11111111-1111-4111-8111-111111111111';
const uploadId = '22222222-2222-4222-8222-222222222222';

describe('secure Orion release file contract', () => {
  it.each([
    { platform: 'MT4', fileName: 'orion.ex4', accepted: true },
    { platform: 'MT4', fileName: 'orion.zip', accepted: true },
    { platform: 'MT4', fileName: 'orion.ex5', accepted: false },
    { platform: 'MT5', fileName: 'orion.ex5', accepted: true },
    { platform: 'MT5', fileName: 'orion.zip', accepted: true },
    { platform: 'MT5', fileName: 'orion.ex4', accepted: false },
    { platform: 'Both', fileName: 'orion.zip', accepted: true },
    { platform: 'Both', fileName: 'orion.ex4', accepted: false },
    { platform: 'Both', fileName: 'orion.ex5', accepted: false },
  ] as const)('enforces $platform package compatibility for $fileName', ({ platform, fileName, accepted }) => {
    const result = validateReleaseFileMetadata({
      fileName,
      sizeBytes: 1024,
      contentType: fileName.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
      platform: platform as ReleasePlatform,
    });

    expect(Boolean(result.data)).toBe(accepted);
    expect(Boolean(result.error)).toBe(!accepted);
  });

  it('accepts exactly 50 MB and rejects the first byte above the limit', () => {
    const atLimit = validateReleaseFileMetadata({
      fileName: 'orion.ex5',
      sizeBytes: releaseUploadMaxBytes,
      contentType: 'application/octet-stream',
      platform: 'MT5',
    });
    const aboveLimit = validateReleaseFileMetadata({
      fileName: 'orion.ex5',
      sizeBytes: releaseUploadMaxBytes + 1,
      contentType: 'application/octet-stream',
      platform: 'MT5',
    });

    expect(atLimit.data?.sizeBytes).toBe(50 * 1024 * 1024);
    expect(atLimit.error).toBeNull();
    expect(aboveLimit.data).toBeNull();
    expect(aboveLimit.error).toContain('50 MB or smaller');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid byte size: %s', (sizeBytes) => {
    const result = validateReleaseFileMetadata({
      fileName: 'orion.ex5',
      sizeBytes,
      contentType: 'application/octet-stream',
      platform: 'MT5',
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain('invalid size');
  });

  it('normalizes safe browser MIME variants but rejects an explicitly unsafe type', () => {
    expect(normalizedReleaseContentType(' Application/ZIP; charset=binary ', 'zip')).toBe('application/zip');
    expect(normalizedReleaseContentType('', 'ex5')).toBe('application/octet-stream');

    const result = validateReleaseFileMetadata({
      fileName: 'orion.ex5',
      sizeBytes: 2048,
      contentType: 'text/html',
      platform: 'MT5',
    });
    expect(result.data).toBeNull();
    expect(result.error).toContain('not supported');
  });

  it('extracts only the allowed final extension, case-insensitively', () => {
    expect(releaseFileExtension('Orion.EX5')).toBe('ex5');
    expect(releaseFileExtension('Orion.release.zip')).toBe('zip');
    expect(releaseFileExtension('Orion.ex5.exe')).toBeNull();
    expect(releaseFileExtension('Orion')).toBeNull();
  });

  it('removes path traversal, control characters, and header-breaking filename characters', () => {
    expect(safeReleaseFileName('../../private/Orion Gold.ex5')).toBe('Orion Gold.ex5');
    const headerBreakingName = safeReleaseFileName('C:\\private\\Orion\r\n"Gold"<5>.ex5');
    expect(headerBreakingName).toMatch(/^Orion-+Gold--5-\.ex5$/);
    expect(headerBreakingName).not.toMatch(/[\r\n"<>\\/]/);
    expect(safeReleaseFileName('   Orion     Premium.zip   ')).toBe('Orion Premium.zip');
    expect(safeReleaseFileName('x'.repeat(200)).length).toBe(140);
  });

  it('builds a server-owned object path and binds it to the release UUID', () => {
    const path = releaseStoragePath(releaseId, uploadId, 'ex5');

    expect(path).toBe(`releases/${releaseId}/${uploadId}.ex5`);
    expect(isSafeReleaseStoragePath(path)).toBe(true);
    expect(isSafeReleaseStoragePath(path, releaseId)).toBe(true);
    expect(isSafeReleaseStoragePath(path, '33333333-3333-4333-8333-333333333333')).toBe(false);
  });

  it.each([
    '../releases/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.ex5',
    'releases/11111111-1111-4111-8111-111111111111/../../secret.ex5',
    'releases/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.exe',
    'releases/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.ex5?download=1',
    'releases/not-a-uuid/22222222-2222-4222-8222-222222222222.ex5',
  ])('rejects an unsafe storage object path: %s', (path) => {
    expect(isSafeReleaseStoragePath(path, releaseId)).toBe(false);
  });
});
