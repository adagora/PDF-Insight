import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function contentSecurityPolicy(apiUrl: string): Plugin {
  const apiOrigin = new URL(apiUrl).origin;
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "pdf-insight-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = env.VITE_API_URL ?? "http://localhost:8787";
  return {
    base: env.VITE_BASE ?? "/",
    plugins: [react(), contentSecurityPolicy(apiUrl)],
    build: {
      target: "es2022",
      sourcemap: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          assetFileNames: (asset: { names: readonly string[] }) =>
            asset.names.some((name) => name.endsWith(".mjs"))
              ? "assets/[name]-[hash].js"
              : "assets/[name]-[hash][extname]",
        },
      },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
