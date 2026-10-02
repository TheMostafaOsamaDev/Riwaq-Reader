import { defineConfig } from "vitest/config";
import { whatsNew } from "./vite-plugin-whats-new";

export default defineConfig({
  plugins: [whatsNew()],
  test: {
    environment: "node",
    // `.tsx` too: a component render test is far clearer written in JSX
    // than in createElement calls, and passing `children` through a props
    // object to dodge that is what biome's noChildrenProp forbids.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
