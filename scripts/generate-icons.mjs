import sharp from "sharp";
import { copyFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";

const src = resolve("APP logo.png");

const androidSizes = [
  { dir: "android/app/src/main/res/mipmap-mdpi",    size: 48  },
  { dir: "android/app/src/main/res/mipmap-hdpi",    size: 72  },
  { dir: "android/app/src/main/res/mipmap-xhdpi",   size: 96  },
  { dir: "android/app/src/main/res/mipmap-xxhdpi",  size: 144 },
  { dir: "android/app/src/main/res/mipmap-xxxhdpi", size: 192 },
];

for (const { dir, size } of androidSizes) {
  mkdirSync(dir, { recursive: true });
  await sharp(src).resize(size, size).png().toFile(join(dir, "ic_launcher.png"));
  await sharp(src).resize(size, size).png().toFile(join(dir, "ic_launcher_round.png"));
  await sharp(src).resize(size, size).png().toFile(join(dir, "ic_launcher_foreground.png"));
  console.log(`✓ ${size}x${size} → ${dir}`);
}

// Also generate web favicon
await sharp(src).resize(32, 32).toFile("public/favicon.png");
await sharp(src).resize(512, 512).toFile("public/icon-512.png");
await sharp(src).resize(192, 192).toFile("public/icon-192.png");
console.log("✓ Web icons generated");
