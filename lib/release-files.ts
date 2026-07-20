export const releaseBucket = 'orion-ea-releases';
export const releaseUploadMaxBytes = 50 * 1024 * 1024;
export const releaseUploadMaxLabel = '50 MB';
export const releaseAllowedMimeTypes = [
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
] as const;

export type ReleasePlatform = 'MT4' | 'MT5' | 'Both';

export type ReleaseFileMetadata = {
  fileName: string;
  sizeBytes: number;
  contentType: string;
  extension: 'ex4' | 'ex5' | 'zip';
};

export function validateReleaseFileMetadata(input: {
  fileName: string;
  sizeBytes: number;
  contentType?: string | null;
  platform: ReleasePlatform;
}): { data: ReleaseFileMetadata; error: null } | { data: null; error: string } {
  const fileName = safeReleaseFileName(input.fileName);
  const extension = releaseFileExtension(fileName);
  if (!extension) return { data: null, error: 'Choose an .ex4, .ex5, or .zip Orion build.' };
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { data: null, error: 'The selected file is empty or has an invalid size.' };
  if (input.sizeBytes > releaseUploadMaxBytes) return { data: null, error: `Orion release files must be ${releaseUploadMaxLabel} or smaller.` };
  if (input.platform === 'MT4' && !['ex4', 'zip'].includes(extension)) return { data: null, error: 'MT4 releases must use an .ex4 or .zip file.' };
  if (input.platform === 'MT5' && !['ex5', 'zip'].includes(extension)) return { data: null, error: 'MT5 releases must use an .ex5 or .zip file.' };
  if (input.platform === 'Both' && extension !== 'zip') return { data: null, error: 'A release for both platforms must be packaged as a .zip file.' };
  const explicitContentType = input.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (explicitContentType && !releaseAllowedMimeTypes.includes(explicitContentType as typeof releaseAllowedMimeTypes[number])) return { data: null, error: 'The selected file type is not supported.' };
  const contentType = normalizedReleaseContentType(input.contentType, extension);
  if (!releaseAllowedMimeTypes.includes(contentType as typeof releaseAllowedMimeTypes[number])) return { data: null, error: 'The selected file type is not supported.' };
  return { data: { fileName, sizeBytes: input.sizeBytes, contentType, extension }, error: null };
}

export function releaseFileExtension(fileName: string) {
  const match = safeReleaseFileName(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1];
  return extension === 'ex4' || extension === 'ex5' || extension === 'zip' ? extension : null;
}

export function safeReleaseFileName(value: string) {
  const base = value.normalize('NFKC').split(/[\\/]/).pop()?.trim() || 'orion-release';
  const sanitized = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '-').replace(/\s+/g, ' ').slice(0, 140);
  return sanitized || 'orion-release';
}

export function normalizedReleaseContentType(value: string | null | undefined, extension: string) {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized && releaseAllowedMimeTypes.includes(normalized as typeof releaseAllowedMimeTypes[number])) return normalized;
  return extension === 'zip' ? 'application/zip' : 'application/octet-stream';
}

export function releaseStoragePath(releaseId: string, uploadId: string, extension: string) {
  return `releases/${releaseId}/${uploadId}.${extension}`;
}

export function isSafeReleaseStoragePath(value: unknown, releaseId?: string) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^releases\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(ex4|ex5|zip)$/i);
  return Boolean(match && (!releaseId || match[1].toLowerCase() === releaseId.toLowerCase()));
}

export function formatReleaseBytes(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value < 1) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
