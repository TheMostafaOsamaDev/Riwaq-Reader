import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `.tsx` too: a component render test is far clearer written in JSX
    // than in createElement calls, and passing `children` through a props
    // object to dodge that is what biome's noChildrenProp forbids.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
