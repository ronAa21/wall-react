export type Attachment = {
  name: string;
  size: number;
  type: string;
  url: string;
};

export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const BUCKET = "attachments";

const ACCEPTED = [
  "image/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
];

export const ACCEPT_ATTRIBUTE =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

export function isAccepted(file: File) {
  return ACCEPTED.some((pattern) =>
    pattern.endsWith("/*") ? file.type.startsWith(pattern.slice(0, -1)) : file.type.startsWith(pattern),
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Uploaded straight through XHR rather than supabase.storage, because only
// XHR reports upload progress.
export function uploadFile(
  file: File,
  onProgress: (percent: number) => void,
): Promise<Attachment> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${crypto.randomUUID()}-${safeName}`;

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`);
    request.setRequestHeader("apikey", supabaseKey);
    request.setRequestHeader("Authorization", `Bearer ${supabaseKey}`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve({
          name: file.name,
          size: file.size,
          type: file.type,
          url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`,
        });
        return;
      }

      let message = `Upload failed (${request.status})`;
      try {
        const body = JSON.parse(request.responseText);
        if (typeof body?.message === "string") message = body.message;
      } catch {
        // Non-JSON error body: keep the status-based message.
      }

      reject(
        new Error(
          message.includes("Bucket not found")
            ? "Attachment storage is not set up. Run the SQL in supabase/schema.sql."
            : message,
        ),
      );
    };

    request.onerror = () => reject(new Error("Upload failed. Check your connection."));
    request.send(file);
  });
}
