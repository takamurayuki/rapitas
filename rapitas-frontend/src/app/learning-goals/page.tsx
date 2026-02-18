'use client';
import { useEffect, useState, useCallback } from 'react';
import type { LearningGoal, GeneratedLearningPlan, Category } from '@/types';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Trash2,
  CheckCircle2,
  Lightbulb,
  Target,
  ListTodo,
  BookOpen,
  Clock,
  Calendar,
  ArrowRight,
  Loader2,
  BookMarked,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';

// ウィザードのステップ
type WizardStep = 'goal' | 'level' | 'schedule' | 'confirm';

const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
  { key: 'goal', label: '学習目標' },
  { key: 'level', label: 'レベル設定' },
  { key: 'schedule', label: '期間・時間' },
  { key: 'confirm', label: '確認' },
];

export default function LearningGoalsPage() {
  const { showToast } = useToast();
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<LearningGoal | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>('goal');
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  // ウィザードフォームデータ
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    currentLevel: '',
    targetLevel: '',
    deadline: '',
    dailyHours: 2,
    categoryId: undefined as number | undefined,
  });

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`);
      if (res.ok) {
        setGoals(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch learning goals:', e);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(
          data.filter(
            (c: Category) => c.mode === 'learning' || c.mode === 'both',
          ),
        );
      }
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchGoals(), fetchCategories()]).finally(() =>
      setLoading(false),
    );
  }, [fetchGoals, fetchCategories]);

  const resetWizard = () => {
    setFormData({
      title: '',
      description: '',
      currentLevel: '',
      targetLevel: '',
      deadline: '',
      dailyHours: 2,
      categoryId: undefined,
    });
    setCurrentStep('goal');
    setShowWizard(false);
  };

  const handleCreateGoal = async () => {
    if (!formData.title.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || undefined,
          currentLevel: formData.currentLevel || undefined,
          targetLevel: formData.targetLevel || undefined,
          deadline: formData.deadline || undefined,
          dailyHours: formData.dailyHours,
          categoryId: formData.categoryId,
        }),
      });

      if (res.ok) {
        const newGoal = await res.json();
        showToast('学習目標を作成しました', 'success');
        resetWizard();
        await fetchGoals();
        // 自動的にプラン生成を開始
        handleGeneratePlan(newGoal.id);
      }
    } catch (e) {
      console.error('Failed to create learning goal:', e);
      showToast('作成に失敗しました', 'error');
    }
  };

  const handleGeneratePlan = async (goalId: number) => {
    setGenerating(true);
    // 対象の目標を選択状態にする
    const targetGoal = goals.find((g) => g.id === goalId);
    if (targetGoal) setSelectedGoal(targetGoal);

    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goalId}/generate-plan`,
        {
          method: 'POST',
        },
      );

      if (res.ok) {
        const result = await res.json();
        showToast(
          result.source === 'ai'
            ? 'AIが学習プランを生成しました'
            : '学習プランを生成しました',
          'success',
        );
        await fetchGoals();
        // 更新された目標を選択
        const updated = await fetch(`${API_BASE_URL}/learning-goals/${goalId}`);
        if (updated.ok) {
          setSelectedGoal(await updated.json());
        }
      } else {
        showToast('プラン生成に失敗しました', 'error');
      }
    } catch (e) {
      console.error('Failed to generate plan:', e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyPlan = async (goal: LearningGoal) => {
    if (goal.isApplied) {
      showToast('このプランは既に適用済みです', 'info');
      return;
    }
    if (
      !confirm(
        'この学習プランをタスクとして登録しますか？\nテーマが自動作成され、タスク・サブタスクが登録されます。',
      )
    )
      return;

    setApplying(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/learning-goals/${goal.id}/apply`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(
            `${result.createdTaskCount}件のタスクを登録しました（テーマ: ${result.themeName}）`,
            'success',
          );
          await fetchGoals();
          const updated = await fetch(
            `${API_BASE_URL}/learning-goals/${goal.id}`,
          );
          if (updated.ok) {
            setSelectedGoal(await updated.json());
          }
        } else {
          showToast(result.error || '適用に失敗しました', 'error');
        }
      }
    } catch (e) {
      console.error('Failed to apply plan:', e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('この学習目標を削除しますか？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/learning-goals/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('学習目標を削除しました', 'success');
        if (selectedGoal?.id === id) setSelectedGoal(null);
        await fetchGoals();
      }
    } catch (e) {
      console.error('Failed to delete:', e);
      showToast('削除に失敗しました', 'error');
    }
  };

  const togglePhase = (index: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getParsedPlan = (goal: LearningGoal): GeneratedLearningPlan | null => {
    if (!goal.generatedPlan) return null;
    try {
      return JSON.parse(goal.generatedPlan) as GeneratedLearningPlan;
    } catch {
      return null;
    }
  };

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
  };

  const getStepIndex = (step: WizardStep) =>
    WIZARD_STEPS.findIndex((s) => s.key === step);

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'goal':
        return formData.title.trim().length > 0;
      case 'level':
        return true; // optional
      case 'schedule':
        return true; // has defaults
      case 'confirm':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const idx = getStepIndex(currentStep);
    if (idx < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[idx + 1].key);
    }
  };

  const prevStep = () => {
    const idx = getStepIndex(currentStep);
    if (idx > 0) {
      setCurrentStep(WIZARD_STEPS[idx - 1].key);
    }
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
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookMarked className="w-8 h-8 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              学習目標
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              具体的な目標を設定し、AIが最適な学習プランを自動生成
            </p>
          </div>
        </div>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Target className="w-4 h-4" />
            新しい目標を設定
          </button>
        )}
      </div>

      {/* ウィザード */}
      {showWizard && (
        <div className="mb-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* ステップインジケーター */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            {WIZARD_STEPS.map((step, idx) => (
              <button
                key={step.key}
                onClick={() => {
                  // 現在のステップ以前のステップには自由に戻れる
                  if (idx <= getStepIndex(currentStep)) {
                    goToStep(step.key);
                  }
                }}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${
                  step.key === currentStep
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                    : idx < getStepIndex(currentStep)
                      ? 'text-emerald-500 dark:text-emerald-400 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                      : 'text-zinc-400 dark:text-zinc-500 cursor-default'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      step.key === currentStep
                        ? 'bg-emerald-600 text-white'
                        : idx < getStepIndex(currentStep)
                          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {idx < getStepIndex(currentStep) ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
              </button>
            ))}
          </div>

          {/* ステップコンテンツ */}
          <div className="p-6">
            {/* Step 1: 学習目標 */}
            {currentStep === 'goal' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    何を学びたいですか？
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    具体的な学習目標を入力してください。例:「競技プログラミングでレッドコーダーになる」「本当に市場価値が高いAIエンジニアになる」
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    学習目標 *
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder="例: 競技プログラミングでレッドコーダーになる"
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    詳しい説明（任意）
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="例: AtCoderのレーティングを2800以上にしたい。アルゴリズムの基礎から応用まで体系的に学び、コンテストで安定して高得点を取れるようになりたい。"
                    rows={3}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Step 2: レベル設定 */}
            {currentStep === 'level' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    現在のレベルと目標レベルを教えてください
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    AIが最適なプランを作成するために、現在のスキルレベルと目指すレベルを入力してください。
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    現在のレベル
                  </label>
                  <input
                    type="text"
                    value={formData.currentLevel}
                    onChange={(e) =>
                      setFormData({ ...formData, currentLevel: e.target.value })
                    }
                    placeholder="例: 茶色コーダー、プログラミング歴1年、基本情報合格済み"
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    目標レベル
                  </label>
                  <input
                    type="text"
                    value={formData.targetLevel}
                    onChange={(e) =>
                      setFormData({ ...formData, targetLevel: e.target.value })
                    }
                    placeholder="例: レッドコーダー、年収1000万円のAIエンジニア、TOEIC900点"
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            {/* Step 3: 期間・時間 */}
            {currentStep === 'schedule' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                    いつまでに達成したいですか？
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    期限と1日の学習時間を設定してください。AIがその条件に合った学習プランを作成します。
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    達成期限
                  </label>
                  <input
                    type="date"
                    value={formData.deadline}
                    onChange={(e) =>
                      setFormData({ ...formData, deadline: e.target.value })
                    }
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    未設定の場合、デフォルトで3ヶ月のプランが生成されます
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    1日の学習時間
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.5}
                      max={8}
                      step={0.5}
                      value={formData.dailyHours}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dailyHours: parseFloat(e.target.value),
                        })
                      }
                      className="flex-1 accent-emerald-600"
                    />
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 min-w-[4rem] text-center">
                      {formData.dailyHours}h / 日
                    </span>
                  </div>
                </div>
                {categories.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      カテゴリ（任意）
                    </label>
                    <select
                      value={formData.categoryId ?? ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          categoryId: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        })
                      }
                      className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">自動（学習カテゴリ）</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: 確認 */}
            {currentStep === 'confirm' && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
                  内容を確認してください
                </h2>
                <div className="bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-4 space-y-3">
                  <div>
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      学習目標
                    </span>
                    <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {formData.title}
                    </p>
                  </div>
                  {formData.description && (
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        詳細
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.description}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        現在のレベル
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.currentLevel || '未指定'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        目標レベル
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.targetLevel || '未指定'}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        達成期限
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.deadline
                          ? new Date(formData.deadline).toLocaleDateString(
                              'ja-JP',
                            )
                          : '未設定（3ヶ月）'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        学習時間
                      </span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formData.dailyHours}時間 / 日
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    作成後、AIが自動で最適な学習プランを生成します
                  </p>
                </div>
              </div>
            )}

            {/* ナビゲーションボタン */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <div>
                {currentStep !== 'goal' ? (
                  <button
                    onClick={prevStep}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    戻る
                  </button>
                ) : (
                  <button
                    onClick={resetWizard}
                    className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                )}
              </div>
              <div>
                {currentStep === 'confirm' ? (
                  <button
                    onClick={handleCreateGoal}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    目標を作成して学習プランを生成
                  </button>
                ) : (
                  <button
                    onClick={nextStep}
                    disabled={!canProceed()}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    次へ
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左: 目標一覧 */}
        <div className="lg:col-span-1">
          {goals.length > 0 ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
              <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3">
                目標一覧
              </h2>
              <div className="space-y-2">
                {goals.map((goal) => (
                  <button
                    key={goal.id}
                    onClick={() => {
                      setSelectedGoal(goal);
                      setExpandedPhases(new Set());
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
                      selectedGoal?.id === goal.id
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700'
                        : 'bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm truncate">
                          {goal.title}
                        </span>
                        {goal.isApplied && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            goal.status === 'active'
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : goal.status === 'completed'
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'bg-zinc-100 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300'
                          }`}
                        >
                          {goal.status === 'active'
                            ? '進行中'
                            : goal.status === 'completed'
                              ? '達成'
                              : 'アーカイブ'}
                        </span>
                        {goal.deadline && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            〜
                            {new Date(goal.deadline).toLocaleDateString(
                              'ja-JP',
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            !showWizard && (
              <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                <Target className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  まだ学習目標がありません。
                  <br />
                  「新しい目標を設定」から始めましょう。
                </p>
              </div>
            )
          )}
        </div>

        {/* 右: 詳細・プラン表示 */}
        <div className="lg:col-span-2">
          {generating ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                AIが学習プランを生成しています...
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                目標に最適な学習ソース、書籍、タスクを分析中です
              </p>
            </div>
          ) : selectedGoal ? (
            <GoalDetailPanel
              goal={selectedGoal}
              plan={getParsedPlan(selectedGoal)}
              applying={applying}
              expandedPhases={expandedPhases}
              onTogglePhase={togglePhase}
              onApply={() => handleApplyPlan(selectedGoal)}
              onRegenerate={() => handleGeneratePlan(selectedGoal.id)}
              onDelete={() => handleDelete(selectedGoal.id)}
            />
          ) : (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <BookMarked className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                学習目標を選択してください
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                左のリストから目標を選択するか、新しい目標を設定してAIに最適な学習プランを生成させましょう。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 目標詳細パネルコンポーネント
function GoalDetailPanel({
  goal,
  plan,
  applying,
  expandedPhases,
  onTogglePhase,
  onApply,
  onRegenerate,
  onDelete,
}: {
  goal: LearningGoal;
  plan: GeneratedLearningPlan | null;
  applying: boolean;
  expandedPhases: Set<number>;
  onTogglePhase: (index: number) => void;
  onApply: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            {goal.title}
            {goal.isApplied && (
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full">
                適用済み
              </span>
            )}
          </h2>
          {goal.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {goal.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {plan && !goal.isApplied && (
            <button
              onClick={onApply}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
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
          {!goal.isApplied && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-300"
            >
              <Sparkles className="w-4 h-4" />
              <span>再生成</span>
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* メタ情報 */}
      <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        {goal.currentLevel && (
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-4 h-4" />
            <span>
              {goal.currentLevel} → {goal.targetLevel || '未設定'}
            </span>
          </div>
        )}
        {goal.deadline && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>〜{new Date(goal.deadline).toLocaleDateString('ja-JP')}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          <span>{goal.dailyHours}時間 / 日</span>
        </div>
      </div>

      {/* 学習プラン */}
      {plan ? (
        <>
          {/* フェーズ一覧 */}
          <div className="space-y-3 mb-6">
            {plan.phases.map((phase, index) => (
              <div
                key={index}
                className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => onTogglePhase(index)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-sm shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {phase.name}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {phase.days}日間 ・ {phase.tasks.length}タスク
                      {phase.description && ` ・ ${phase.description}`}
                    </p>
                  </div>
                  {expandedPhases.has(index) ? (
                    <ChevronUp className="w-5 h-5 text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-zinc-400 shrink-0" />
                  )}
                </button>
                {expandedPhases.has(index) && (
                  <div className="border-t border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
                    {phase.tasks.map((task, taskIndex) => (
                      <div
                        key={taskIndex}
                        className="bg-zinc-50 dark:bg-zinc-700/30 rounded-lg p-3"
                      >
                        <div className="flex items-start gap-2">
                          <BookOpen className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
                              {task.title}
                            </h4>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap">
                              {task.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {task.estimatedHours && (
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {task.estimatedHours}h
                                </span>
                              )}
                              {task.priority && (
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                                    task.priority === 'high'
                                      ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                      : task.priority === 'low'
                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {task.priority === 'high'
                                    ? '高'
                                    : task.priority === 'low'
                                      ? '低'
                                      : '中'}
                                </span>
                              )}
                            </div>
                            {/* サブタスク */}
                            {task.subtasks && task.subtasks.length > 0 && (
                              <div className="mt-2 pl-3 border-l-2 border-emerald-200 dark:border-emerald-800 space-y-1.5">
                                {task.subtasks.map((sub, subIndex) => (
                                  <div key={subIndex} className="text-xs">
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                      {sub.title}
                                    </span>
                                    {sub.description && (
                                      <span className="text-zinc-500 dark:text-zinc-400">
                                        {' '}
                                        - {sub.description}
                                      </span>
                                    )}
                                    {sub.estimatedHours && (
                                      <span className="text-zinc-400 dark:text-zinc-500">
                                        {' '}
                                        ({sub.estimatedHours}h)
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* おすすめリソース */}
          {plan.recommendedResources &&
            plan.recommendedResources.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-4">
                <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  おすすめ学習リソース
                </h3>
                <div className="space-y-2">
                  {plan.recommendedResources.map((resource, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${
                          resource.type === 'book'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : resource.type === 'course'
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : resource.type === 'video'
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : resource.type === 'practice'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {resource.type === 'book'
                          ? '書籍'
                          : resource.type === 'course'
                            ? 'コース'
                            : resource.type === 'video'
                              ? '動画'
                              : resource.type === 'practice'
                                ? '演習'
                                : 'Web'}
                      </span>
                      <div>
                        <span className="font-medium text-blue-800 dark:text-blue-200">
                          {resource.title}
                        </span>
                        <span className="text-blue-600 dark:text-blue-300">
                          {' '}
                          - {resource.description}
                        </span>
                        {resource.url && (
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 ml-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* ヒント */}
          {plan.tips && plan.tips.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                学習のヒント
              </h3>
              <ul className="space-y-1">
                {plan.tips.map((tip, index) => (
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

          {/* タスク適用の案内 */}
          {!goal.isApplied && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <ListTodo className="w-4 h-4 shrink-0" />
                「タスクに適用」ボタンを押すと、テーマが自動作成され、学習タスク・サブタスクが登録されます
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Sparkles className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            学習プランはまだ生成されていません
          </p>
          <button
            onClick={onRegenerate}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors mx-auto"
          >
            <Sparkles className="w-4 h-4" />
            学習プランを生成
          </button>
        </div>
      )}
    </div>
  );
}
