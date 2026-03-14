import AgentSettingsClient from './AgentSettingsClient';

// NOTE: Required for static export — generates placeholder route params at build time.
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function AgentSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <AgentSettingsClient params={params} />;
}
