import { defineConfig } from "bumpp";

export default defineConfig({
  tag: true,
  commit: true,
  push: true,
  tagName: "v%s",
  files: [
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
  ],
});
