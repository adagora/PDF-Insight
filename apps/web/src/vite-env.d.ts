interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BASE?: string;
  readonly VITE_PROFILE_INSPECTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
