import { Suspense } from "react";
import FocusClient from "./FocusClient";

export default function FocusPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 flex items-center justify-center">
          <div className="text-white text-lg">読み込み中...</div>
        </div>
      }
    >
      <FocusClient />
    </Suspense>
  );
}
