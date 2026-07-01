import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

export function getFormattedDate(): string {
  const date = new Date();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}${month}`;
}

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Saves a base64 photo to the local device's filesystem.
 * If running on a native platform (Capacitor), saves to Directory.Documents inside a subfolder.
 * On Web, saves to a mock directory and returns a local representation.
 */
export async function savePhotoLocally(
  base64Data: string,
  fileName: string
): Promise<string> {
  // Strip metadata prefix (e.g., "data:image/jpeg;base64,") if present
  const base64Clean = base64Data.includes("base64,")
    ? base64Data.split("base64,")[1]
    : base64Data;

  const cleanFileName = fileName.endsWith(".jpg") ? fileName : `${fileName}.jpg`;

  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.writeFile({
        path: `ACmpCompressorPhotos/${cleanFileName}`,
        data: base64Clean,
        directory: Directory.Documents,
        recursive: true,
      });
      console.log("[photo] Photo saved to documents directory:", result.uri);
      return result.uri;
    } catch (err: any) {
      console.warn("[photo] Documents folder write failed, falling back to cache:", err.message);
      try {
        const result = await Filesystem.writeFile({
          path: cleanFileName,
          data: base64Clean,
          directory: Directory.Cache,
        });
        return result.uri;
      } catch (innerErr: any) {
        console.error("[photo] Cache write failed too:", innerErr.message);
        throw innerErr;
      }
    }
  } else {
    // Web fallback simulated path
    const mockPath = `local_device_storage/ACmpCompressorPhotos/${cleanFileName}`;
    console.log("[photo] Web browser mock path generated:", mockPath);
    return mockPath;
  }
}

/**
 * Triggers standard file dialog for capturing image and returns it as a Base64 string
 */
export function capturePhotoFromDevice(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment"; // requests rear camera on mobile devices

    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read file as string"));
        }
      };
      reader.onerror = () => {
        reject(reader.error || new Error("File reading error"));
      };
      reader.readAsDataURL(file);
    };

    input.click();
  });
}
