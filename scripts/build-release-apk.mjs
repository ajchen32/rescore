#!/usr/bin/env node
/**
 * Builds a production Android APK without expo-dev-client (no Metro splash).
 * Restores package.json afterwards. Run `npm run prebuild:dev` before
 * day-to-day Metro / expo-dev-client development again.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(root, "package.json");
const originalPackage = readFileSync(packagePath, "utf8");

const DEV_CLIENT_PACKAGES = [
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
  "expo-dev-menu-interface",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }
}

function patchAutolinkingExclude() {
  const pkg = JSON.parse(originalPackage);
  pkg.expo = {
    ...(pkg.expo ?? {}),
    autolinking: {
      ...(pkg.expo?.autolinking ?? {}),
      exclude: [
        ...new Set([...(pkg.expo?.autolinking?.exclude ?? []), ...DEV_CLIENT_PACKAGES]),
      ],
    },
  };
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function restorePackageJson() {
  writeFileSync(packagePath, originalPackage);
}

function ensureLocalProperties() {
  const sdkDir =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(homedir(), "Android", "Sdk");
  writeFileSync(join(root, "android", "local.properties"), `sdk.dir=${sdkDir}\n`);
}

function tuneGradleMemory() {
  const gradlePropertiesPath = join(root, "android", "gradle.properties");
  let text = readFileSync(gradlePropertiesPath, "utf8");
  text = text.replace(
    /org\.gradle\.jvmargs=.*/g,
    "org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8"
  );
  // Phone APKs don't need x86 emulator ABIs; fewer ABIs = less memory during release.
  text = text.replace(
    /reactNativeArchitectures=.*/g,
    "reactNativeArchitectures=armeabi-v7a,arm64-v8a"
  );
  writeFileSync(gradlePropertiesPath, text);
}

try {
  console.log("Building Rescore release APK (no expo-dev-client)…");
  patchAutolinkingExclude();

  run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], {
    env: { ...process.env, RESCORE_VARIANT: "release" },
  });

  ensureLocalProperties();
  tuneGradleMemory();

  run("./gradlew", ["assembleRelease", "--no-daemon"], {
    cwd: join(root, "android"),
    env: {
      ...process.env,
      RESCORE_VARIANT: "release",
      GRADLE_OPTS: "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
    },
  });

  const apkSrc = join(
    root,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk"
  );
  const distDir = join(root, "dist");
  mkdirSync(distDir, { recursive: true });
  const apkDest = join(distDir, "rescore-release.apk");
  copyFileSync(apkSrc, apkDest);

  console.log(`\nRelease APK ready:\n  ${apkDest}\n`);
  console.log("Install with:\n  adb install -r dist/rescore-release.apk\n");
  console.log("Before developing with Metro again, run:\n  npm run prebuild:dev\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  restorePackageJson();
}
