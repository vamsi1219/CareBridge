// SYNTHETIC DEMO CODE. Prescription draft extraction for CareBridge demo data only.
// Not medical advice, not a diagnosis, and never used to make clinical decisions.
//
// Risks and limits:
// - The key is read from the client bundle. EXPO_PUBLIC_ values are embedded in the JS
//   bundle, so anyone can extract them. Production must proxy this call through a backend
//   (none exists in this project).
// - The EXPO_PUBLIC_ prefix is not injected by the bare React Native CLI without extra
//   setup, so the key is usually null here and the SAMPLE draft is returned.
// - The endpoint requires the key in the URL query string, so it may appear in logs.
// - The image is not attached to the request (no file read is available), so the model
//   only sees a text reference to the image and its output is not a reading of the photo.

export interface PrescriptionDraft {
  prescribedByDoc: string;
  medicineName: string;
  strength: string;
  timingSlot: string;
  dailyUnitsNeeded: string;
  remainingTablets: string;
  source: 'AI' | 'SAMPLE';
}

type PrescriptionDraftFields = Omit<PrescriptionDraft, 'source'>;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
}

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const GEMINI_TIMEOUT_MS = 15000;

// Deterministic synthetic sample; returned whenever AI extraction is unavailable.
function sampleDraft(): PrescriptionDraft {
  return {
    prescribedByDoc: 'Dr. Sample Physician',
    medicineName: 'Sample Tablet 10mg',
    strength: '10 mg',
    timingSlot: 'Morning',
    dailyUnitsNeeded: '1',
    remainingTablets: '20',
    source: 'SAMPLE',
  };
}

// Returns the Gemini key from EXPO_PUBLIC_GEMINI_API_KEY, or null. Never throws.
export function getGeminiApiKey(): string | null {
  try {
    if (typeof process === 'undefined' || !process.env) return null;
    const key: unknown = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    return typeof key === 'string' && key.trim().length > 0 ? key : null;
  } catch {
    return null;
  }
}

function buildPrompt(imageUri: string): string {
  return [
    'This is a synthetic demo request. Extract prescription fields from the referenced photo.',
    'Note: the image could not be attached to this request; only its reference text is provided.',
    `Image reference: ${imageUri}`,
    'Respond with JSON only, with exactly these string fields:',
    'prescribedByDoc, medicineName, strength, timingSlot, dailyUnitsNeeded, remainingTablets.',
    'If a field cannot be read, use an empty string. Do not give medical advice.',
  ].join('\n');
}

function isDraftFields(value: unknown): value is PrescriptionDraftFields {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.prescribedByDoc === 'string' &&
    typeof v.medicineName === 'string' &&
    typeof v.strength === 'string' &&
    typeof v.timingSlot === 'string' &&
    typeof v.dailyUnitsNeeded === 'string' &&
    typeof v.remainingTablets === 'string'
  );
}

// Calls Gemini with a 15-second timeout. Any failure returns the SAMPLE draft; never throws.
export async function extractPrescriptionDraft(imageUri: string): Promise<PrescriptionDraft> {
  const key = getGeminiApiKey();
  if (key === null) return sampleDraft();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(imageUri) }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return sampleDraft();

    const payload = (await response.json()) as GeminiResponse | null;
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return sampleDraft();

    const parsed: unknown = JSON.parse(text);
    if (!isDraftFields(parsed)) return sampleDraft();

    return {
      prescribedByDoc: parsed.prescribedByDoc,
      medicineName: parsed.medicineName,
      strength: parsed.strength,
      timingSlot: parsed.timingSlot,
      dailyUnitsNeeded: parsed.dailyUnitsNeeded,
      remainingTablets: parsed.remainingTablets,
      source: 'AI',
    };
  } catch {
    return sampleDraft();
  } finally {
    clearTimeout(timer);
  }
}
