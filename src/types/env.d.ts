// Minimal ambient declaration so EXPO_PUBLIC_* env reads type-check without @types/node.
declare const process: { env: Record<string, string | undefined> };
