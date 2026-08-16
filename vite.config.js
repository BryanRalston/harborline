import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

const pages = process.env.GITHUB_PAGES === "1";

function serveRepoAssets() {
  const root = path.resolve(process.cwd(), "assets");
  return {
    name: "harborline-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        let raw = req.url.split("?")[0];
        if (raw.startsWith("/harborline/assets/")) raw = raw.slice("/harborline".length);
        if (!raw.startsWith("/assets/")) return next();
        const rel = decodeURIComponent(raw.slice("/assets/".length));
        const file = path.normalize(path.join(root, rel));
        if (!file.startsWith(root)) return next();
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        const ext = path.extname(file).toLowerCase();
        res.setHeader(
          "Content-Type",
          { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[ext] ||
            "application/octet-stream"
        );
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(root)) return;
      fs.cpSync(root, path.resolve(process.cwd(), "dist/assets"), { recursive: true });
    },
  };
}

export default defineConfig({
  base: pages ? "/harborline/" : "/",
  publicDir: "public",
  plugins: [serveRepoAssets()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/.debug/**", "**/node_modules/**"],
    },
  },
});
