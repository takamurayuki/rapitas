"use client";
import { useEffect, useState } from "react";
import type { ExamGoal, StudyPlan, GeneratedStudyPlan } from "@/types";
import {
  Sparkles,
  Calendar,
  Clock,
  BookOpen,
  ChevronRight,
  Trash2,
  CheckCircle2,
  Lightbulb,
  Target,
  Play,
  ListTodo,
} from "lucide-react";
import { useToast } from "@/components/ui/toast/ToastContainer";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function StudyPlansPage() {
  const { showToast } = useToast();
  const [examGoals, setExamGoals] = useState<ExamGoal[]>([]);
  const [studyPlans, setStudyPlans] = useState<StudyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<StudyPlan | null>(null);

  // 生成フォーム
  const [formData, setFormData] = useState({
    subject: "",
    examDate: "",
    targetScore: "",
    studyHoursPerDay: 2,
    currentLevel: "intermediate",
  });

  const [generatedResult, setGeneratedResult] = useState<{
    generatedPlan: GeneratedStudyPlan;
    startDate: string;
    endDate: string;
    totalDays: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([fetchExamGoals(), fetchStudyPlans()]).finally(() =>
      setLoading(false),
    );
  }, []);

  const fetchExamGoals = async () => {
    try {
      const res = await fetch(`${API_BASE}/exam-goals`);
      if (res.ok) {
        const data = await res.json();
        setExamGoals(data.filter((g: ExamGoal) => !g.isCompleted));
      }
    } catch (e) {
      console.error("Failed to fetch exam goals:", e);
    }
  };

  const fetchStudyPlans = async () => {
    try {
      const res = await fetch(`${API_BASE}/study-plans`);
      if (res.ok) {
        setStudyPlans(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch study plans:", e);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subject.trim() || !formData.examDate) return;

    setGenerating(true);
    setGeneratedResult(null);

    try {
      const res = await fetch(`${API_BASE}/study-plans/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        const result = await res.json();
        setGeneratedResult(result);
      }
    } catch (e) {
      console.error("Failed to generate study plan:", e);
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePlan = async () => {
    if (!generatedResult) return;

    try {
      const res = await fetch(`${API_BASE}/study-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: formData.subject,
          prompt: `${formData.subject}の学習計画（${formData.currentLevel}レベル、1日${formData.studyHoursPerDay}時間）`,
          generatedPlan: generatedResult.generatedPlan,
          totalDays: generatedResult.totalDays,
          startDate: generatedResult.startDate,
          endDate: generatedResult.endDate,
        }),
      });

      if (res.ok) {
        fetchStudyPlans();
        setGeneratedResult(null);
        setFormData({
          subject: "",
          examDate: "",
          targetScore: "",
          studyHoursPerDay: 2,
          currentLevel: "intermediate",
        });
      }
    } catch (e) {
      console.error("Failed to save study plan:", e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("この学習計画を削除しますか？")) return;
    try {
      const res = await fetch(`${API_BASE}/study-plans/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchStudyPlans();
        if (selectedPlan?.id === id) {
          setSelectedPlan(null);
        }
        showToast("学習計画を削除しました", "success");
      }
    } catch (e) {
      console.error("Failed to delete study plan:", e);
      showToast("削除に失敗しました", "error");
    }
  };

  const applyPlanToTasks = async (plan: StudyPlan) => {
    if (plan.isApplied) {
      showToast("この計画は既に適用済みです", "info");
      return;
    }
    if (!confirm("この学習計画をタスクとして作成しますか？")) return;

    setApplying(true);
    try {
      const res = await fetch(`${API_BASE}/study-plans/${plan.id}/apply`, {
        method: "POST",
      });
      if (res.ok) {
        const result = await res.json();
        showToast(`${result.count}件のタスクを作成しました`, "success");
        fetchStudyPlans();
        // 選択中の計画を更新
        if (selectedPlan?.id === plan.id) {
          setSelectedPlan({ ...plan, isApplied: true });
        }
      } else {
        showToast("タスクの作成に失敗しました", "error");
      }
    } catch (e) {
      console.error("Failed to apply study plan:", e);
      showToast("エラーが発生しました", "error");
    } finally {
      setApplying(false);
    }
  };

  const selectExamGoal = (goal: ExamGoal) => {
    setFormData({
      ...formData,
      subject: goal.name,
      examDate: goal.examDate.split("T")[0],
      targetScore: goal.targetScore || "",
    });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-8 h-8 text-violet-500" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            AI学習計画
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AIが最適な学習計画を自動生成
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 計画生成フォーム */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4">
              新しい計画を生成
            </h2>

            {/* 試験目標からクイック選択 */}
            {examGoals.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  試験目標から選択
                </label>
                <div className="flex flex-wrap gap-2">
                  {examGoals.slice(0, 3).map((goal) => (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => selectExamGoal(goal)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        formData.subject === goal.name
                          ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                          : "border-zinc-200 dark:border-zinc-600 hover:border-violet-300 dark:hover:border-violet-600"
                      }`}
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>{goal.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  科目/試験名 *
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) =>
                    setFormData({ ...formData, subject: e.target.value })
                  }
                  placeholder="例: TOEIC、基本情報技術者"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  目標日 *
                </label>
                <input
                  type="date"
                  value={formData.examDate}
                  onChange={(e) =>
                    setFormData({ ...formData, examDate: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  目標スコア（任意）
                </label>
                <input
                  type="text"
                  value={formData.targetScore}
                  onChange={(e) =>
                    setFormData({ ...formData, targetScore: e.target.value })
                  }
                  placeholder="例: 800点、合格"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  1日の学習時間
                </label>
                <select
                  value={formData.studyHoursPerDay}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      studyHoursPerDay: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value={1}>1時間</option>
                  <option value={2}>2時間</option>
                  <option value={3}>3時間</option>
                  <option value={4}>4時間以上</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  現在のレベル
                </label>
                <select
                  value={formData.currentLevel}
                  onChange={(e) =>
                    setFormData({ ...formData, currentLevel: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="beginner">初心者</option>
                  <option value="intermediate">中級者</option>
                  <option value="advanced">上級者</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>学習計画を生成</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* 保存済み計画一覧 */}
          {studyPlans.length > 0 && (
            <div className="mt-4 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
              <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
                保存済みの計画
              </h2>
              <div className="space-y-2">
                {studyPlans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
                      selectedPlan?.id === plan.id
                        ? "bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700"
                        : "bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                          {plan.subject}
                        </span>
                        {plan.isApplied && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {plan.totalDays}日間の計画
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 生成結果/詳細表示 */}
        <div className="lg:col-span-2">
          {generatedResult ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-violet-500" />
                  生成された学習計画
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGeneratedResult(null)}
                    className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSavePlan}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    保存
                  </button>
                </div>
              </div>

              <div className="mb-6 p-4 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                      {generatedResult.totalDays}
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      日間
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                      {generatedResult.generatedPlan.studyHoursPerDay}h
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      /日
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                      {generatedResult.generatedPlan.phases.length}
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      フェーズ
                    </div>
                  </div>
                </div>
              </div>

              {/* フェーズ */}
              <div className="space-y-4 mb-6">
                {generatedResult.generatedPlan.phases.map((phase, index) => (
                  <div
                    key={index}
                    className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {phase.name}
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {phase.days}日間 ・ {phase.dailyHours.toFixed(1)}
                          時間/日
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {phase.tasks.map((task, taskIndex) => (
                        <li
                          key={taskIndex}
                          className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400"
                        >
                          <BookOpen className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{task}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* ヒント */}
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  学習のヒント
                </h3>
                <ul className="space-y-1">
                  {generatedResult.generatedPlan.tips.map((tip, index) => (
                    <li
                      key={index}
                      className="text-sm text-amber-700 dark:text-amber-300"
                    >
                      • {tip}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 保存後の案内 */}
              <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4">
                <p className="text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                  <ListTodo className="w-4 h-4 shrink-0" />
                  保存後、「タスクに適用」ボタンでこの計画をタスクとして登録できます
                </p>
              </div>
            </div>
          ) : selectedPlan ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                    {selectedPlan.subject}
                  </h2>
                  {selectedPlan.isApplied && (
                    <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                      適用済み
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!selectedPlan.isApplied && (
                    <button
                      onClick={() => applyPlanToTasks(selectedPlan)}
                      disabled={applying}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {applying ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>適用中...</span>
                        </>
                      ) : (
                        <>
                          <ListTodo className="w-4 h-4" />
                          <span>タスクに適用</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selectedPlan.id)}
                    className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="mb-6 flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {new Date(selectedPlan.startDate).toLocaleDateString(
                      "ja-JP",
                    )}
                    {" 〜 "}
                    {new Date(selectedPlan.endDate).toLocaleDateString("ja-JP")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  <span>{selectedPlan.totalDays}日間</span>
                </div>
              </div>

              {/* フェーズ */}
              <div className="space-y-4 mb-6">
                {selectedPlan.generatedPlan.phases.map((phase, index) => (
                  <div
                    key={index}
                    className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {phase.name}
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {phase.days}日間 ・ {phase.dailyHours.toFixed(1)}
                          時間/日
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {phase.tasks.map((task, taskIndex) => (
                        <li
                          key={taskIndex}
                          className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400"
                        >
                          <BookOpen className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{task}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* ヒント */}
              {selectedPlan.generatedPlan.tips && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    学習のヒント
                  </h3>
                  <ul className="space-y-1">
                    {selectedPlan.generatedPlan.tips.map((tip, index) => (
                      <li
                        key={index}
                        className="text-sm text-amber-700 dark:text-amber-300"
                      >
                        • {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <Sparkles className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                AI学習計画を生成しましょう
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                科目と目標日を入力すると、AIが最適な学習スケジュールを自動で作成します。
                フェーズごとに分かれた具体的な学習タスクが提案されます。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
