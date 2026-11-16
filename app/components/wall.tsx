"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  type Profile,
  fileToAvatar,
  getProfileSnapshot,
  getServerProfileSnapshot,
  saveProfile,
  subscribeProfile,
} from "@/utils/profile";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILES,
  MAX_FILE_BYTES,
  type Attachment,
  formatBytes,
  isAccepted,
  uploadFile,
} from "@/utils/upload";

const MAX_LENGTH = 280;

export type Post = {
  id: number;
  content: string;
  author_name: string;
  created_at: string;
  attachments: Attachment[];
};

type PendingFile = {
  id: string;
  file: File;
  preview: string | null;
  progress: number | null;
};

function handleOf(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9_]+/g, "");
  return `@${slug || "guest"}`;
}

function mergePost(posts: Post[], incoming: Post) {
  if (posts.some((post) => post.id === incoming.id)) return posts;
  return [incoming, ...posts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function compactTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Client-only rendering so server and client cannot disagree about "3m".
const noopSubscribe = () => () => {};

function useClientTime(iso: string, format: (value: string) => string) {
  return useSyncExternalStore(
    noopSubscribe,
    () => format(iso),
    () => "",
  );
}

function Timestamp({ iso }: { iso: string }) {
  const label = useClientTime(iso, relativeTime);
  return (
    <time dateTime={iso} className="text-[13px] text-[#71767B]">
      {label}
    </time>
  );
}

function CompactTime({ iso }: { iso: string }) {
  const label = useClientTime(iso, compactTime);
  return <time dateTime={iso}>{label}</time>;
}

function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URL, not optimizable
      <img
        src={src}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: "#1D9BF0",
        fontSize: size * 0.42,
      }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function FileBadge({ type }: { type: string }) {
  const label = type === "application/pdf" ? "PDF" : type.startsWith("image/") ? "IMG" : "DOC";
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${
        type === "application/pdf" ? "bg-[#DC2626]" : "bg-[#1D9BF0]"
      }`}
      aria-hidden
    >
      {label}
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[#E7E9EA] ring-1 ring-[#2F3336] transition-colors hover:bg-[#16181C]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="h-2.5 w-2.5"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function ProfileSidebar({
  profile,
  onSave,
  onError,
}: {
  profile: Profile;
  onSave: (fields: { name: string; networks: string; city: string }) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftNetworks, setDraftNetworks] = useState("");
  const [draftCity, setDraftCity] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function startEditing() {
    setDraftName(profile.name === "Guest" ? "" : profile.name);
    setDraftNetworks(profile.networks);
    setDraftCity(profile.city);
    setEditing(true);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ name: draftName, networks: draftNetworks, city: draftCity });
    setEditing(false);
  }

  async function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      saveProfile({ ...profile, avatar: await fileToAvatar(file) });
    } catch (uploadError) {
      onError(uploadError instanceof Error ? uploadError.message : "Could not load that image.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative flex h-28 items-center justify-center overflow-hidden rounded-2xl bg-[#16181C] min-[1200px]:aspect-square min-[1200px]:h-auto"
      >
        {profile.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL, not optimizable
          <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[56px] font-bold leading-none text-[#1D9BF0] min-[1200px]:text-[96px]">
            {profile.name.charAt(0).toUpperCase()}
          </span>
        )}

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          aria-label="Change profile photo"
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-[#E7E9EA] ring-1 ring-[#2F3336] transition-colors hover:bg-black"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <path d="M14.5 4h-5L8 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-1.5-2Z" />
            <circle cx="12" cy="12.5" r="3.2" />
          </svg>
        </button>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={handlePhoto}
          className="hidden"
        />
      </div>

      <div className="rounded-2xl bg-[#16181C] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold">Information</h2>
          {editing ? null : (
            <button
              type="button"
              onClick={startEditing}
              className="text-[14px] font-medium text-[#1D9BF0] hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[13px] text-[#71767B]">Name</span>
              <input
                autoFocus
                maxLength={40}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Your name"
                className="mt-1 h-9 w-full rounded-lg border border-[#2F3336] bg-black px-3 text-[14px] outline-none placeholder:text-[#71767B] focus:border-[#1D9BF0]"
              />
            </label>
            <label className="block">
              <span className="text-[13px] text-[#71767B]">Networks</span>
              <input
                maxLength={40}
                value={draftNetworks}
                onChange={(event) => setDraftNetworks(event.target.value)}
                placeholder="Batch 2010"
                className="mt-1 h-9 w-full rounded-lg border border-[#2F3336] bg-black px-3 text-[14px] outline-none placeholder:text-[#71767B] focus:border-[#1D9BF0]"
              />
            </label>
            <label className="block">
              <span className="text-[13px] text-[#71767B]">Current city</span>
              <input
                maxLength={40}
                value={draftCity}
                onChange={(event) => setDraftCity(event.target.value)}
                placeholder="Cebu City"
                className="mt-1 h-9 w-full rounded-lg border border-[#2F3336] bg-black px-3 text-[14px] outline-none placeholder:text-[#71767B] focus:border-[#1D9BF0]"
              />
            </label>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="rounded-full bg-[#1D9BF0] px-4 py-1.5 text-[14px] font-bold text-white hover:bg-[#1A8CD8]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-[14px] font-medium text-[#71767B] hover:text-[#E7E9EA]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[13px] text-[#71767B]">Name</div>
              <div className="text-[14px]">{profile.name}</div>
            </div>
            <div>
              <div className="text-[13px] text-[#71767B]">Networks</div>
              <div className={`text-[14px] ${profile.networks ? "" : "text-[#71767B]"}`}>
                {profile.networks || "Not set"}
              </div>
            </div>
            <div>
              <div className="text-[13px] text-[#71767B]">Current city</div>
              <div className={`text-[14px] ${profile.city ? "" : "text-[#71767B]"}`}>
                {profile.city || "Not set"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Wall({
  initialPosts,
  loadError = null,
}: {
  initialPosts: Post[];
  loadError?: string | null;
}) {
  const [supabase] = useState(createClient);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [isLive, setIsLive] = useState(false);

  const profile = useSyncExternalStore(
    subscribeProfile,
    getProfileSnapshot,
    getServerProfileSnapshot,
  );

  const attachInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const channel = supabase
      .channel("custom-all-channel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          setPosts((prev) => mergePost(prev, payload.new as Post));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          const updated = payload.new as Post;
          setPosts((prev) => prev.map((post) => (post.id === updated.id ? updated : post)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload) => {
          const removed = payload.old as { id: number };
          setPosts((prev) => prev.filter((post) => post.id !== removed.id));
        },
      )
      .subscribe((status) => setIsLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const remaining = MAX_LENGTH - content.length;
  const canShare = content.trim().length > 0 && content.length <= MAX_LENGTH && !sending;

  const isMine = (post: Post) => profile.aliases.includes(post.author_name);
  const authorLabel = (post: Post) => (isMine(post) ? profile.name : post.author_name);

  function saveProfileFields(fields: { name: string; networks: string; city: string }) {
    const nextName = fields.name.trim() || "Guest";
    const previousName = profile.name;

    // Posts carrying any name you have used are shown with the current one, so
    // the rename is instant and does not depend on the database.
    saveProfile({
      ...profile,
      name: nextName,
      networks: fields.networks,
      city: fields.city,
      aliases: [...profile.aliases, previousName],
    });
    setError(null);

    if (nextName !== previousName) void pushRename(previousName, nextName);
  }

  // Best effort: also renames the rows so other visitors see the new name.
  // Silently does nothing when the posts table has no UPDATE policy.
  async function pushRename(previousName: string, nextName: string) {
    const { error: renameError } = await supabase
      .from("posts")
      .update({ author_name: nextName })
      .eq("author_name", previousName);

    if (renameError) setError(renameError.message);
  }

  function addFiles(incoming: File[]) {
    const room = MAX_FILES - files.length;
    const accepted: PendingFile[] = [];
    const messages: string[] = [];

    for (const file of incoming) {
      if (accepted.length >= room) {
        messages.push(`You can attach up to ${MAX_FILES} files.`);
        break;
      }
      if (!isAccepted(file)) {
        messages.push(`${file.name}: only images, PDF and documents.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        messages.push(`${file.name} is larger than 10 MB.`);
        continue;
      }

      accepted.push({
        id: crypto.randomUUID(),
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        progress: null,
      });
    }

    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (messages.length) setError(messages[0]);
  }

  function removeFile(id: string) {
    const target = files.find((item) => item.id === id);
    if (target?.preview) URL.revokeObjectURL(target.preview);
    setFiles((prev) => prev.filter((item) => item.id !== id));
  }

  function clearFiles() {
    setFiles((prev) => {
      prev.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      return [];
    });
  }

  function handleAttachInput(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (list?.length) addFiles(Array.from(list));
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(Array.from(event.dataTransfer.files));
  }

  async function handleShare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH || sending) return;

    setSending(true);
    setError(null);

    try {
      const uploaded: Attachment[] = [];
      for (const item of files) {
        setFiles((prev) =>
          prev.map((entry) => (entry.id === item.id ? { ...entry, progress: 0 } : entry)),
        );

        uploaded.push(
          await uploadFile(item.file, (percent) =>
            setFiles((prev) =>
              prev.map((entry) =>
                entry.id === item.id ? { ...entry, progress: percent } : entry,
              ),
            ),
          ),
        );
      }

      const { data, error: insertError } = await supabase
        .from("posts")
        .insert({
          content: trimmed,
          author_name: profile.name,
          attachments: uploaded,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);

      setContent("");
      clearFiles();
      if (data) setPosts((prev) => mergePost(prev, data as Post));
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Could not share that post.");
      // Drop the stuck "Uploading 100%" state so the tiles can be retried.
      setFiles((prev) => prev.map((entry) => ({ ...entry, progress: null })));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      <div className="mx-auto flex max-w-[1272px]">
        <nav className="sticky top-0 hidden h-screen w-[296px] shrink-0 flex-col px-4 py-3 lg:flex">
          <a
            href="#feed"
            aria-label="Wall home"
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1D9BF0] text-[13px] font-bold"
          >
            W
          </a>

          <a
            href="#feed"
            className="mt-6 flex w-fit items-center gap-4 rounded-full py-2 pr-4 text-[20px] font-bold hover:bg-[#16181C]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
              aria-hidden
            >
              <path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
            </svg>
            Feed
          </a>

          <div className="mb-2 mt-auto flex items-center gap-3">
            <Avatar name={profile.name} src={profile.avatar} size={44} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold">{profile.name}</div>
              <div className="truncate text-[14px] text-[#71767B]">{handleOf(profile.name)}</div>
            </div>
          </div>
        </nav>

        <main id="feed" className="min-w-0 flex-1 border-[#2F3336] lg:border-x">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#2F3336] bg-black/85 px-4 py-3 backdrop-blur">
            <h1 className="text-[20px] font-bold">Feed</h1>
            <div className="flex items-center gap-2 text-[13px] text-[#71767B]">
              <span>
                {posts.length} post{posts.length === 1 ? "" : "s"}
              </span>
              <span
                className={`h-2 w-2 rounded-full ${isLive ? "bg-[#00BA7C]" : "bg-[#71767B]"}`}
                aria-hidden
              />
              <span>{isLive ? "Live" : "Connecting…"}</span>
            </div>
          </header>

          <div className="border-b border-[#2F3336] p-4 min-[1200px]:hidden">
            <ProfileSidebar profile={profile} onSave={saveProfileFields} onError={setError} />
          </div>

          <form
            onSubmit={handleShare}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`border-b border-[#2F3336] px-4 py-3 transition-colors ${
              dragging ? "bg-[#16181C]" : ""
            }`}
          >
            <div className="flex gap-3">
              <Avatar name={profile.name} src={profile.avatar} />

              <div className="min-w-0 flex-1">
                <label htmlFor="new-post" className="sr-only">
                  Write something on the wall
                </label>
                <textarea
                  id="new-post"
                  rows={2}
                  maxLength={MAX_LENGTH}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full resize-none bg-transparent pt-2 text-[20px] leading-snug outline-none placeholder:text-[#71767B]"
                />

                {files.length > 0 ? (
                  <div className="flex flex-wrap gap-3 pb-2">
                    {files.map((item) =>
                      item.preview ? (
                        <div
                          key={item.id}
                          className="relative h-24 w-24 overflow-hidden rounded-xl border border-[#2F3336] bg-[#16181C]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                          <img src={item.preview} alt="" className="h-full w-full object-cover" />
                          {item.progress !== null ? (
                            <>
                              <div className="absolute inset-0 flex items-end justify-center bg-black/60 pb-3 text-[11px] font-medium text-white">
                                Uploading {item.progress}%
                              </div>
                              <div
                                className="absolute bottom-0 left-0 h-1 bg-[#1D9BF0] transition-[width]"
                                style={{ width: `${item.progress}%` }}
                              />
                            </>
                          ) : null}
                          <RemoveButton
                            onClick={() => removeFile(item.id)}
                            label={`Remove ${item.file.name}`}
                          />
                        </div>
                      ) : (
                        <div
                          key={item.id}
                          className="relative flex h-24 w-[220px] items-center gap-3 rounded-xl border border-[#2F3336] bg-[#16181C] px-3"
                        >
                          <FileBadge type={item.file.type} />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold">
                              {item.file.name}
                            </div>
                            <div className="text-[12px] text-[#71767B]">
                              {item.progress !== null
                                ? `Uploading ${item.progress}%`
                                : formatBytes(item.file.size)}
                            </div>
                          </div>
                          <RemoveButton
                            onClick={() => removeFile(item.id)}
                            label={`Remove ${item.file.name}`}
                          />
                        </div>
                      ),
                    )}
                  </div>
                ) : null}

                <div className="mt-2 flex items-center gap-3 border-t border-[#2F3336] pt-3">
                  <button
                    type="button"
                    onClick={() => attachInput.current?.click()}
                    aria-label="Attach files"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[#1D9BF0] transition-colors hover:bg-[#1D9BF0]/10"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                      aria-hidden
                    >
                      <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>

                  <span
                    className={`ml-auto text-[13px] ${
                      remaining <= 20 ? "font-medium text-[#F4212E]" : "text-[#71767B]"
                    }`}
                    aria-live="polite"
                  >
                    {remaining} characters remaining
                  </span>

                  <button
                    type="submit"
                    disabled={!canShare}
                    className="rounded-full bg-[#1D9BF0] px-5 py-2 text-[14px] font-bold text-white transition-colors hover:bg-[#1A8CD8] disabled:cursor-not-allowed disabled:bg-[#1D9BF0]/40"
                  >
                    {sending ? "Sharing…" : "Share"}
                  </button>
                </div>
              </div>
            </div>

            <p className="mt-2 text-[12px] text-[#71767B]">
              Up to {MAX_FILES} files, 10 MB each. Images, PDF and documents. You can also drop
              files onto the box.
            </p>

            <input
              ref={attachInput}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              onChange={handleAttachInput}
              className="hidden"
            />
          </form>

          {error ? (
            <p
              role="alert"
              className="mx-4 mt-3 rounded-lg border border-[#F4212E]/40 bg-[#F4212E]/10 px-3 py-2 text-[12px] text-[#F4212E]"
            >
              {error}
            </p>
          ) : null}

          {posts.length === 0 ? (
            <p className="px-4 py-16 text-center text-[15px] text-[#71767B]">
              No posts yet. Be the first to write on the wall.
            </p>
          ) : (
            <ul>
              {posts.map((post) => (
                <li
                  key={post.id}
                  className="flex gap-3 border-b border-[#2F3336] px-4 py-3 transition-colors hover:bg-[#080808]"
                >
                  <Avatar name={authorLabel(post)} src={isMine(post) ? profile.avatar : null} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1 text-[14px]">
                      <span className="font-bold">{authorLabel(post)}</span>
                      <span className="text-[#71767B]">{handleOf(authorLabel(post))}</span>
                      <span className="text-[#71767B]">·</span>
                      <span className="text-[#71767B]">
                        <CompactTime iso={post.created_at} />
                      </span>
                    </div>

                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                      {post.content}
                    </p>

                    {post.attachments?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {post.attachments.map((attachment) =>
                          attachment.type.startsWith("image/") ? (
                            <a
                              key={attachment.url}
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- remote Storage file */}
                              <img
                                src={attachment.url}
                                alt={attachment.name}
                                className="max-h-[510px] max-w-full rounded-2xl border border-[#2F3336] object-cover"
                              />
                            </a>
                          ) : (
                            <a
                              key={attachment.url}
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex w-full max-w-[420px] items-center gap-3 rounded-2xl border border-[#2F3336] bg-[#16181C] px-3 py-2.5 transition-colors hover:border-[#1D9BF0]/50"
                            >
                              <FileBadge type={attachment.type} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-semibold">
                                  {attachment.name}
                                </div>
                                <div className="text-[12px] text-[#71767B]">
                                  {formatBytes(attachment.size)}
                                </div>
                              </div>
                              <span className="text-[12px] font-medium text-[#1D9BF0]">
                                Download
                              </span>
                            </a>
                          ),
                        )}
                      </div>
                    ) : null}

                    <div className="mt-2">
                      <Timestamp iso={post.created_at} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>

        <aside className="hidden w-[298px] shrink-0 flex-col px-4 py-3 min-[1200px]:flex">
          <ProfileSidebar profile={profile} onSave={saveProfileFields} onError={setError} />
        </aside>
      </div>
    </div>
  );
}
