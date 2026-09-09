import { CliAuth } from "./cli-auth";

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string; device_name?: string; os?: string; arch?: string }>;
}) {
  const params = await searchParams;
  return <CliAuth callback={params.callback ?? ""} state={params.state ?? ""} deviceName={params.device_name ?? "Unknown device"} os={params.os ?? "unknown"} arch={params.arch ?? "unknown"} />;
}
