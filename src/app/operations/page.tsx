import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import OperationsWorkspace from "@/components/operations-workspace";

export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  const user = await currentUser((await cookies()).get("liam_session")?.value);
  if (!user || user.role !== "owner") redirect("/");
  return <OperationsWorkspace />;
}
