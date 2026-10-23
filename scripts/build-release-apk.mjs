#!/usr/bin/env node
/**
 * Builds a release APK from the existing android/ project and optionally
 * installs it on a phone.
 *
 *   npm run build:apk   build dist/rescore-release.apk (phone ABIs)
 *   npm run phone       build for the connected device and install + launch it
 *
 * expo-dev-launcher and expo-dev-menu swap in empty stubs for release builds, so
 * the same android/ folder serves both Metro development and release APKs; there
 * is no prebuild round trip and the dev build cache stays warm.
 *
 * Device selection for --install: ANDROID_SERIAL if set, otherwise the single
 * connected device (physical preferred over emulators). If nothing is connected,
 * phones paired for Wireless debugging on the same network are found over mDNS
 * and connected automatically.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(root, "android");
const appId = "com.pianopdfparser.app";
const phoneAbis = "armeabi-v7a,arm64-v8a";
const install = process.argv.includes("--install");

const sdkDir =
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), "Android", "Sdk");
const sdkAdb = join(sdkDir, "platform-tools", "adb");
const adbPath = existsSync(sdkAdb) ? sdkAdb : "adb";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ANDROID_HOME: sdkDir, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }
}

function adb(args) {
  const result = spawnSync(adbPath, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function connectedDevices() {
  return adb(["devices"])
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

// Android 11+ Wireless debugging advertises paired phones over mDNS; connect to
// any that are visible so `npm run phone` works without a cable.
function connectWirelessDevices() {
  // A server started by an older adb (e.g. a distro package) has no mDNS
  // support; restart it with this adb so discovery works.
  if (!adb(["mdns", "check"]).includes("mdns daemon")) {
    adb(["kill-server"]);
    adb(["start-server"]);
  }
  const services = adb(["mdns", "services"]);
  for (const line of services.split("\n")) {
    const match = line.match(/_adb-tls-connect\._tcp\.?\s+(\S+:\d+)/);
    if (match) {
      console.log(`Connecting to ${match[1]} over Wi-Fi…`);
      adb(["connect", match[1]]);
    }
  }
}

function pickDevice() {
  if (process.env.ANDROID_SERIAL) {
    return process.env.ANDROID_SERIAL;
  }

  let devices = connectedDevices();
  if (devices.length === 0) {
    connectWirelessDevices();
    devices = connectedDevices();
  }
  if (devices.length === 0) {
    throw new Error(
      "No device found. Plug in a phone with USB debugging, or pair it once for Wireless debugging (see README)."
    );
  }

  const physical = devices.filter((serial) => !serial.startsWith("emulator-"));
  // A Wi-Fi phone can be listed twice (adb's mDNS auto-connect and an explicit
  // `adb connect`); count each hardware serial once.
  const seen = new Set();
  const candidates = (physical.length > 0 ? physical : devices).filter((serial) => {
    const hardwareSerial = adb(["-s", serial, "shell", "getprop", "ro.serialno"]) || serial;
    if (seen.has(hardwareSerial)) {
      return false;
    }
    seen.add(hardwareSerial);
    return true;
  });
  if (candidates.length > 1) {
    throw new Error(
      `Several devices are connected (${candidates.join(", ")}). Pick one with ANDROID_SERIAL=<serial> npm run phone.`
    );
  }
  return candidates[0];
}

function ensureAndroidProject() {
  if (!existsSync(join(androidDir, "gradlew"))) {
    console.log("No android/ project yet; generating it…");
    run("npx", ["expo", "prebuild", "--platform", "android"]);
  }
  writeFileSync(join(androidDir, "local.properties"), `sdk.dir=${sdkDir}\n`);
}

try {
  const device = install ? pickDevice() : null;
  // Building only the device's own ABI is several times faster than every phone ABI.
  const abis = device ? adb(["-s", device, "shell", "getprop", "ro.product.cpu.abi"]) || phoneAbis : phoneAbis;
  const emulatorRunning = connectedDevices().some((serial) => serial.startsWith("emulator-"));

  ensureAndroidProject();
  console.log(`Building Rescore release APK for ${abis}${device ? ` (${device})` : ""}…`);
  run(
    "./gradlew",
    [
      "assembleRelease",
      `-PreactNativeArchitectures=${abis}`,
      // A release build next to a running emulator can exhaust RAM; fewer
      // parallel workers keeps the Gradle daemon from being OOM-killed.
      ...(emulatorRunning ? ["--max-workers=2"] : []),
    ],
    { cwd: androidDir, env: { NODE_ENV: "production" } }
  );

  const apkSrc = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  const distDir = join(root, "dist");
  mkdirSync(distDir, { recursive: true });
  const apkDest = join(distDir, "rescore-release.apk");
  copyFileSync(apkSrc, apkDest);
  console.log(`\nRelease APK ready:\n  ${apkDest}\n`);

  if (device) {
    console.log(`Installing on ${device}…`);
    run(adbPath, ["-s", device, "install", "-r", apkDest]);
    adb(["-s", device, "shell", "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"]);
    console.log("Installed and launched.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
