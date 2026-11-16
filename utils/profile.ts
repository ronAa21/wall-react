export type Profile = {
  name: string;
  avatar: string | null;
  networks: string;
  city: string;
  // Every author name this browser has posted or saved under. Posts carrying
  // one of these names are treated as yours and shown with the current name.
  aliases: string[];
};

export const DEFAULT_PROFILE: Profile = {
  name: "Guest",
  avatar: null,
  networks: "",
  city: "",
  aliases: ["Guest"],
};

const STORAGE_KEY = "wall-profile";
const listeners = new Set<() => void>();

let cached: Profile | null = null;

function read(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  if (cached) return cached;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Profile>) : null;
    cached = {
      name:
        typeof parsed?.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : DEFAULT_PROFILE.name,
      avatar: typeof parsed?.avatar === "string" ? parsed.avatar : null,
      networks: typeof parsed?.networks === "string" ? parsed.networks.trim() : "",
      city: typeof parsed?.city === "string" ? parsed.city.trim() : "",
      aliases: Array.isArray(parsed?.aliases)
        ? parsed.aliases.filter((alias): alias is string => typeof alias === "string" && !!alias.trim())
        : DEFAULT_PROFILE.aliases,
    };
  } catch {
    cached = DEFAULT_PROFILE;
  }

  return cached;
}

// Snapshot identity is stable between writes, which is what
// useSyncExternalStore requires to avoid re-rendering forever.
export function getProfileSnapshot(): Profile {
  return read();
}

export function getServerProfileSnapshot(): Profile {
  return DEFAULT_PROFILE;
}

export function subscribeProfile(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveProfile(next: Profile) {
  const name = next.name.trim() || DEFAULT_PROFILE.name;
  const aliases = Array.from(new Set([...next.aliases, name])).filter(Boolean);

  cached = {
    name,
    avatar: next.avatar,
    networks: next.networks.trim(),
    city: next.city.trim(),
    aliases,
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Private mode or a full quota: the profile still applies to this tab.
  }

  listeners.forEach((listener) => listener());
}

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");

  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Your browser could not process that image.");
  }

  // Cover-fit, so a non-square photo is cropped rather than squashed.
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.85);
}
