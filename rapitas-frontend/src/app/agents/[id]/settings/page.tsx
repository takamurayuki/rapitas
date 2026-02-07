import AgentSettingsClient from "./AgentSettingsClient";

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  return [{ id: "_placeholder" }];
}

export default function AgentSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <AgentSettingsClient params={params} />;
}
