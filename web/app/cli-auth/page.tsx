import { CliAuth } from "./cli-auth";

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string }>;
}) {
  const params = await searchParams;
  return <CliAuth callback={params.callback ?? ""} state={params.state ?? ""} />;
}
