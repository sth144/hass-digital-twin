import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "hass-digital-twin.js" },
    outDir: "custom_components/hass_digital_twin/frontend",
    emptyOutDir: true,
  },
});
