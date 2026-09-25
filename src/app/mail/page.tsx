import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import MailWorkspace from "@/components/mail-workspace";

export const dynamic = "force-dynamic";
export default async function MailPage() {
  const user = await currentUser((await cookies()).get("liam_session")?.value);
  if (!user) redirect("/");
  if (user.role !== "owner" && !user.verified_at) redirect("/");
  return <MailWorkspace />;
}
