import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.join(
  process.cwd(),
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
);
const destDir = path.join(process.cwd(), "public");
const dest = path.join(destDir, "maplibre-gl-worker.js");
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("Copied MapLibre worker to public/maplibre-gl-worker.js");
