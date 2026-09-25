import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ConciergeWorkspace from "@/components/concierge-workspace";
export const dynamic="force-dynamic";
export default async function ConciergePage(){const user=await currentUser((await cookies()).get("liam_session")?.value);if(!user || (user.role!=="owner"&&!user.verified_at))redirect("/");return <ConciergeWorkspace />;}
