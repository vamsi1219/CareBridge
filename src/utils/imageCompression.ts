// Image asset validation and normalization helpers for CareBridge uploads.
//
// NOTE: this module does NOT perform real image compression. Compression needs a
// native image module, and this project adds no new native dependencies. The
// functions here only check URI scheme/extension, size limits and MIME type, and
// reshape a picker asset into a { uri, mimeType, fileSize } record.
// Pure TypeScript: no React Native or native module imports.

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp';

export interface ImageAssetInput {
  uri: string;
  fileSize?: number;
  type?: string;
}

export interface NormalizedImageAsset {
  uri: string;
  mimeType: ImageMimeType | null;
  fileSize: number | null;
}

export type ImageAssetValidation = { ok: true } | { ok: false; reason: string };

export const DEFAULT_MAX_IMAGE_BYTES: number = 10 * 1024 * 1024;

const SUPPORTED_EXTENSIONS: Record<string, ImageMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
};

// Strip any query string or fragment so the extension check looks at the path only.
function pathPart(uri: string): string {
  const cut = uri.search(/[?#]/);
  return cut === -1 ? uri : uri.slice(0, cut);
}

function extensionOf(uri: string): string | null {
  const path = pathPart(uri);
  const lastSlash = path.lastIndexOf('/');
  const name = path.slice(lastSlash + 1);
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function isLocalScheme(lower: string): boolean {
  return lower.startsWith('file://') || lower.startsWith('content://');
}

// file:// and content:// are accepted with or without an extension. ph:// and
// http(s):// must end in a supported image extension.
export function isSupportedImageUri(uri: string): boolean {
  const lower = uri.trim().toLowerCase();
  if (lower.length === 0) return false;
  if (isLocalScheme(lower)) return true;
  if (!lower.startsWith('ph://') && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }
  const ext = extensionOf(lower);
  return ext !== null && Object.prototype.hasOwnProperty.call(SUPPORTED_EXTENSIONS, ext);
}

export function inferMimeType(uri: string): ImageMimeType | null {
  const ext = extensionOf(uri.trim());
  if (ext === null) return null;
  return Object.prototype.hasOwnProperty.call(SUPPORTED_EXTENSIONS, ext)
    ? SUPPORTED_EXTENSIONS[ext]
    : null;
}

function mimeFromType(type: string | undefined): ImageMimeType | null {
  if (type === undefined) return null;
  const lower = type.trim().toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (
    lower === 'image/jpeg' ||
    lower === 'image/png' ||
    lower === 'image/heic' ||
    lower === 'image/webp'
  ) {
    return lower;
  }
  return null;
}

export function validateImageAsset(
  asset: ImageAssetInput,
  maxBytes: number = DEFAULT_MAX_IMAGE_BYTES,
): ImageAssetValidation {
  if (!isSupportedImageUri(asset.uri)) {
    return {
      ok: false,
      reason: 'Unsupported image URI or file extension. Use JPG, PNG, HEIC or WEBP.',
    };
  }
  if (asset.fileSize !== undefined && asset.fileSize > maxBytes) {
    return {
      ok: false,
      reason: `File size ${asset.fileSize} bytes exceeds the limit of ${maxBytes} bytes.`,
    };
  }
  return { ok: true };
}

export function normalizeImageAsset(asset: ImageAssetInput): NormalizedImageAsset {
  return {
    uri: asset.uri,
    mimeType: mimeFromType(asset.type) ?? inferMimeType(asset.uri),
    fileSize: asset.fileSize ?? null,
  };
}
