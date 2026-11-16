import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import Wall, { type Post } from "./components/wall";

// The feed is read from cookies() + Postgres on every request, so there is no
// static shell to prerender. Next 16 blocks that by default; this opts the
// route back into a plain blocking render.
export const instant = false;

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, content, author_name, created_at, attachments")
    .order("created_at", { ascending: false });

  return <Wall initialPosts={(posts ?? []) as Post[]} loadError={error?.message ?? null} />;
}
