//! Self-Learning AI Agent Architecture - Rust Reference Design
//!
//! This is a reference implementation showing how the architecture
//! would be designed in Rust. The actual implementation uses TypeScript/Bun.

use std::collections::HashMap;
use std::time::{Duration, SystemTime};

// ============================================
// Core Types
// ============================================

#[derive(Debug, Clone, PartialEq)]
pub enum ExperimentPhase {
    Created,
    Researching,
    Hypothesizing,
    Planning,
    Executing,
    Evaluating,
    Learning,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HypothesisStatus {
    Proposed,
    Testing,
    Validated,
    Invalidated,
    Revised,
}

#[derive(Debug, Clone)]
pub struct CriticScore {
    pub accuracy: f64,  // 0.0 - 1.0
    pub logic: f64,     // 0.0 - 1.0
    pub coverage: f64,  // 0.0 - 1.0
}

impl CriticScore {
    pub fn overall(&self) -> f64 {
        self.accuracy * 0.4 + self.logic * 0.35 + self.coverage * 0.25
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum KnowledgeNodeType {
    Concept,
    Problem,
    Solution,
    Technology,
    Pattern,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KnowledgeEdgeType {
    Related,
    Causes,
    Solves,
    Requires,
    PartOf,
    SimilarTo,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LearningPatternType {
    SuccessStrategy,
    FailurePattern,
    Optimization,
    AntiPattern,
}

// ============================================
// Memory System
// ============================================

/// Short Memory - 現在のタスクコンテキスト
#[derive(Debug, Clone)]
pub struct ShortMemory {
    pub task_id: Option<u64>,
    pub context: HashMap<String, String>,
    pub current_phase: ExperimentPhase,
    pub working_data: Vec<String>,
}

/// Episode Memory - 実験ログ
#[derive(Debug, Clone)]
pub struct EpisodeMemory {
    pub experiment_id: u64,
    pub phase: String,
    pub content: String,
    pub outcome: Option<String>,
    pub emotional_tag: Option<String>,
    pub importance: f64,
    pub timestamp: SystemTime,
}

/// Knowledge Memory - 抽象化された知識
#[derive(Debug, Clone)]
pub struct KnowledgeMemory {
    pub concept: String,
    pub rule: String,
    pub confidence: f64,
    pub decay_score: f64,
}

// ============================================
// Experiment
// ============================================

#[derive(Debug, Clone)]
pub struct Experiment {
    pub id: u64,
    pub task_id: Option<u64>,
    pub title: String,
    pub status: ExperimentPhase,
    pub research: ExperimentResearch,
    pub hypotheses: Vec<Hypothesis>,
    pub plan: Option<ExperimentPlan>,
    pub execution: Option<ExecutionResult>,
    pub evaluation: Option<Evaluation>,
    pub learning: Option<Learning>,
    pub confidence: f64,
    pub duration: Option<Duration>,
}

#[derive(Debug, Clone, Default)]
pub struct ExperimentResearch {
    pub code_analysis: Vec<String>,
    pub document_search: Vec<String>,
    pub memory_search: Vec<String>,
    pub related_experiments: Vec<u64>,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct ExperimentPlan {
    pub steps: Vec<PlanStep>,
    pub estimated_duration: Option<Duration>,
    pub dependencies: Vec<String>,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PlanStep {
    pub id: u32,
    pub description: String,
    pub step_type: StepType,
    pub status: StepStatus,
}

#[derive(Debug, Clone)]
pub enum StepType {
    CodeChange,
    Command,
    FileEdit,
    Test,
    Verification,
}

#[derive(Debug, Clone)]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub artifacts: Vec<String>,
    pub commands_run: Vec<String>,
    pub files_changed: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Evaluation {
    pub tests_passed: u32,
    pub tests_failed: u32,
    pub errors: Vec<String>,
    pub performance_metrics: HashMap<String, f64>,
    pub overall_success: bool,
}

#[derive(Debug, Clone)]
pub struct Learning {
    pub success_factors: Vec<String>,
    pub failure_reasons: Vec<String>,
    pub improvements: Vec<String>,
    pub new_knowledge: Vec<String>,
}

// ============================================
// Hypothesis
// ============================================

#[derive(Debug, Clone)]
pub struct Hypothesis {
    pub id: u64,
    pub content: String,
    pub reasoning: Option<String>,
    pub status: HypothesisStatus,
    pub confidence: f64,
    pub priority: u32,
    pub test_result: Option<HypothesisTestResult>,
    pub parent_id: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct HypothesisTestResult {
    pub passed: bool,
    pub evidence: Vec<String>,
    pub metrics: HashMap<String, f64>,
}

// ============================================
// Critic System
// ============================================

#[derive(Debug, Clone)]
pub enum CriticPhase {
    Hypothesis,
    Plan,
    Execution,
}

#[derive(Debug, Clone)]
pub struct CriticReview {
    pub experiment_id: u64,
    pub phase: CriticPhase,
    pub score: CriticScore,
    pub feedback: String,
    pub suggestions: Vec<String>,
    pub issues: Vec<String>,
}

// ============================================
// Knowledge Graph
// ============================================

#[derive(Debug, Clone)]
pub struct KnowledgeNode {
    pub id: u64,
    pub label: String,
    pub node_type: KnowledgeNodeType,
    pub description: Option<String>,
    pub properties: HashMap<String, String>,
    pub weight: f64,
    pub access_count: u64,
}

#[derive(Debug, Clone)]
pub struct KnowledgeEdge {
    pub id: u64,
    pub from_node_id: u64,
    pub to_node_id: u64,
    pub edge_type: KnowledgeEdgeType,
    pub weight: f64,
}

#[derive(Debug, Clone)]
pub struct Subgraph {
    pub nodes: Vec<KnowledgeNode>,
    pub edges: Vec<KnowledgeEdge>,
}

// ============================================
// Learning Engine
// ============================================

#[derive(Debug, Clone)]
pub struct LearningPattern {
    pub id: u64,
    pub pattern_type: LearningPatternType,
    pub category: String,
    pub description: String,
    pub conditions: Vec<PatternCondition>,
    pub actions: Vec<PatternAction>,
    pub confidence: f64,
    pub occurrences: u32,
}

#[derive(Debug, Clone)]
pub struct PatternCondition {
    pub field: String,
    pub operator: ConditionOperator,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum ConditionOperator {
    Equals,
    Contains,
    Matches,
    Exists,
}

#[derive(Debug, Clone)]
pub struct PatternAction {
    pub action_type: ActionType,
    pub description: String,
    pub template: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ActionType {
    ApplyTemplate,
    SuggestApproach,
    Warn,
    AutoFix,
}

#[derive(Debug, Clone)]
pub struct PromptEvolution {
    pub category: String,
    pub before_prompt: String,
    pub after_prompt: String,
    pub improvement: Option<String>,
    pub performance_delta: f64,
}

// ============================================
// Traits (Interfaces)
// ============================================

/// Experiment Engine trait
pub trait ExperimentEngine {
    fn create_experiment(&mut self, task_id: Option<u64>, title: &str) -> Experiment;
    fn run_research(&mut self, experiment_id: u64, query: &str) -> ExperimentResearch;
    fn generate_hypothesis(&mut self, experiment_id: u64) -> Vec<Hypothesis>;
    fn create_plan(&mut self, experiment_id: u64) -> ExperimentPlan;
    fn execute(&mut self, experiment_id: u64) -> ExecutionResult;
    fn evaluate(&mut self, experiment_id: u64) -> Evaluation;
    fn learn(&mut self, experiment_id: u64) -> Learning;
    fn run_full_loop(&mut self, task_id: Option<u64>, title: &str) -> Experiment;
}

/// Critic System trait
pub trait CriticSystem {
    fn review_hypothesis(&self, experiment_id: u64, content: &str) -> CriticReview;
    fn review_plan(&self, experiment_id: u64, plan: &ExperimentPlan) -> CriticReview;
    fn review_execution(&self, experiment_id: u64, result: &ExecutionResult) -> CriticReview;
    fn calculate_score(&self, phase: CriticPhase, content: &str) -> CriticScore;
}

/// Learning Engine trait
pub trait LearningEngine {
    fn analyze_failure(&self, experiment_id: u64) -> Vec<String>;
    fn extract_strategy(&self, experiment_id: u64) -> Vec<String>;
    fn improve_prompt(&mut self, category: &str, before: &str) -> PromptEvolution;
    fn update_knowledge(&mut self, learning: &Learning);
}

/// Knowledge Graph trait
pub trait KnowledgeGraph {
    fn add_node(&mut self, label: &str, node_type: KnowledgeNodeType) -> KnowledgeNode;
    fn add_edge(&mut self, from: u64, to: u64, edge_type: KnowledgeEdgeType) -> KnowledgeEdge;
    fn find_related(&self, node_id: u64, edge_types: Option<&[KnowledgeEdgeType]>) -> Subgraph;
    fn get_subgraph(&self, node_id: u64, depth: u32) -> Subgraph;
    fn merge_nodes(&mut self, keep_id: u64, remove_id: u64) -> KnowledgeNode;
}

/// Memory System trait
pub trait MemorySystem {
    fn save_short_memory(&mut self, context: ShortMemory);
    fn save_episode(&mut self, episode: EpisodeMemory);
    fn find_similar_episodes(&self, query: &str, limit: usize) -> Vec<EpisodeMemory>;
    fn promote_to_knowledge(&mut self, episode_id: u64) -> KnowledgeMemory;
}

// ============================================
// Example Usage (Pseudocode)
// ============================================

/// Demonstrates the full self-learning loop
pub fn example_self_learning_loop() {
    println!("=== Self-Learning Agent Loop ===");
    println!();
    println!("1. Task received: 'Fix authentication bug'");
    println!();
    println!("2. Research Phase:");
    println!("   - Search knowledge base for 'authentication'");
    println!("   - Find related experiments");
    println!("   - Analyze relevant code files");
    println!();
    println!("3. Hypothesis Phase:");
    println!("   - H1: 'Token validation is failing due to expiry check'");
    println!("   - H2: 'Session middleware is not properly configured'");
    println!("   - Critic reviews: H1 score=0.78, H2 score=0.62");
    println!();
    println!("4. Plan Phase:");
    println!("   Step 1: Check token validation logic");
    println!("   Step 2: Fix expiry comparison");
    println!("   Step 3: Add unit tests");
    println!("   Step 4: Run integration tests");
    println!();
    println!("5. Execute Phase:");
    println!("   - Modified auth/token-validator.ts");
    println!("   - Added test cases");
    println!("   - All tests passing");
    println!();
    println!("6. Evaluate Phase:");
    println!("   - Tests: 12 passed, 0 failed");
    println!("   - Critic score: 0.85");
    println!("   - H1 validated, H2 invalidated");
    println!();
    println!("7. Learn Phase:");
    println!("   - Pattern saved: 'Token expiry bugs often in comparison operators'");
    println!("   - Knowledge graph updated: [JWT] --causes--> [expiry_bug]");
    println!("   - Prompt improved for similar future tasks");
    println!();
    println!("=== Agent has grown from this experience ===");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critic_score_overall() {
        let score = CriticScore {
            accuracy: 0.9,
            logic: 0.8,
            coverage: 0.7,
        };
        let overall = score.overall();
        // 0.9 * 0.4 + 0.8 * 0.35 + 0.7 * 0.25 = 0.36 + 0.28 + 0.175 = 0.815
        assert!((overall - 0.815).abs() < 0.001);
    }

    #[test]
    fn test_experiment_phases() {
        let phases = vec![
            ExperimentPhase::Created,
            ExperimentPhase::Researching,
            ExperimentPhase::Hypothesizing,
            ExperimentPhase::Planning,
            ExperimentPhase::Executing,
            ExperimentPhase::Evaluating,
            ExperimentPhase::Learning,
            ExperimentPhase::Completed,
        ];
        assert_eq!(phases.len(), 8);
    }

    #[test]
    fn test_knowledge_node_types() {
        let types = vec![
            KnowledgeNodeType::Concept,
            KnowledgeNodeType::Problem,
            KnowledgeNodeType::Solution,
            KnowledgeNodeType::Technology,
            KnowledgeNodeType::Pattern,
        ];
        assert_eq!(types.len(), 5);
    }

    #[test]
    fn test_knowledge_edge_types() {
        let types = vec![
            KnowledgeEdgeType::Related,
            KnowledgeEdgeType::Causes,
            KnowledgeEdgeType::Solves,
            KnowledgeEdgeType::Requires,
            KnowledgeEdgeType::PartOf,
            KnowledgeEdgeType::SimilarTo,
        ];
        assert_eq!(types.len(), 6);
    }
}
