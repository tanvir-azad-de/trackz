/// <reference types="vite/client" />

/** Inlined at build by vite.config.ts — see src/app/buildVersion.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

