/** Local preview packaging. Signing/notarization remain explicit release steps. */
module.exports = {
  appId: "com.hotcrossbuns.desktop",
  productName: "Hot Cross Buns",
  directories: { output: "dist/preview" },
  files: ["out/**/*", "package.json"],
  asar: true,
  asarUnpack: ["node_modules/better-sqlite3/**/*"],
  extraResources: [{ from: "assets/logo/logo.png", to: "assets/brand/app-icon.png" }],
  protocols: [{ name: "Hot Cross Buns planner links", schemes: ["hotcrossbuns"] }],
  mac: {
    category: "public.app-category.productivity",
    icon: "dist/brand/app.icns",
    target: ["zip", "dmg"]
  },
  artifactName: "Hot-Cross-Buns-${version}-${arch}.${ext}"
};
