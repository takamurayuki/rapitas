/**
 * analyze-codebase/types
 *
 * All TypeScript interfaces and type definitions used across the codebase
 * analysis modules. Does not contain any runtime logic.
 */

export interface FileInfo {
  path: string;
  relativePath: string;
  ext: string;
  lines: number;
  size: number;
  content: string;
}

export interface ExtensionStats {
  extension: string;
  fileCount: number;
  totalLines: number;
  totalSize: number;
  avgLines: number;
}

export interface Endpoint {
  method: string;
  path: string;
  file: string;
}

export interface PrismaModel {
  name: string;
  fieldCount: number;
  relations: string[];
}

export interface FeatureArea {
  name: string;
  routes: number;
  services: number;
  components: number;
  hooks: number;
  models: number;
  tests: number;
  untestedSourceFiles: string[];
  score: number;
}

export interface ComplexityWarning {
  file: string;
  type:
    | 'god_object'
    | 'oversized'
    | 'critical_size'
    | 'deep_nesting'
    | 'long_function'
    | 'too_many_imports';
  message: string;
  lines: number;
  severity: 'info' | 'warning' | 'critical';
}

export interface SecurityFinding {
  file: string;
  line: number;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  snippet: string;
}

export interface CircularDependency {
  cycle: string[];
}

export interface APIConsistencyIssue {
  endpoint: string;
  file: string;
  type: string;
  message: string;
}

export interface TestCoverageDetail {
  featureName: string;
  sourceFiles: string[];
  testFiles: string[];
  untestedFiles: string[];
  coverageRatio: number;
}

export interface ArchitectureHealth {
  couplingScore: number;
  cohesionScore: number;
  modularity: number;
  highCouplingFiles: {
    file: string;
    importCount: number;
    importedByCount: number;
  }[];
  isolatedFiles: string[];
  layerViolations: { file: string; message: string }[];
}

export interface MaintainabilityMetrics {
  /** Percentage of files under 500 lines. */
  fileSizeScore: number;
  /** Percentage of functions under 100 lines. */
  functionLengthScore: number;
  /** Score based on average max nesting depth. */
  nestingScore: number;
  /** Score based on duplicated block ratio. */
  duplicationScore: number;
  duplicatedBlocks: { hash: string; files: { path: string; startLine: number }[]; lines: number }[];
  totalDuplicatedLines: number;
  /** Duplicated lines divided by total lines. */
  duplicationRatio: number;
  /** Proxy based on branching count per file. */
  avgCyclomaticComplexity: number;
}

export interface AnalysisResult {
  metadata: {
    generatedAt: string;
    executionTimeMs: number;
    projectRoot: string;
    version: string;
  };
  codeMetrics: {
    byExtension: ExtensionStats[];
    byDirectory: Record<string, { files: number; lines: number; size: number }>;
    largestFiles: { path: string; lines: number; size: number }[];
    totalFiles: number;
    totalLines: number;
    totalSize: number;
  };
  architecture: {
    backend: {
      routeFiles: number;
      endpoints: Endpoint[];
      services: string[];
    };
    prisma: {
      modelCount: number;
      models: PrismaModel[];
      totalRelations: number;
      oversizedModels: { name: string; fieldCount: number }[];
    };
    frontend: {
      components: { category: string; count: number; files: string[] }[];
      hooks: string[];
      stores: string[];
      pages: string[];
    };
  };
  quality: {
    testFiles: number;
    sourceFiles: number;
    testRatio: number;
    anyUsage: number;
    todoCount: number;
    fixmeCount: number;
    hackCount: number;
    consoleLogCount: number;
    tryCatchCount: number;
    emptyTryCatchCount: number;
    assertionCount: number;
  };
  complexity: {
    warnings: ComplexityWarning[];
    godObjects: string[];
    avgFileLines: number;
    medianFileLines: number;
    filesOver500Lines: number;
    filesOver1000Lines: number;
    longFunctions: { file: string; name: string; lines: number }[];
  };
  security: {
    findings: SecurityFinding[];
    summary: { high: number; medium: number; low: number };
  };
  imports: {
    circularDependencies: CircularDependency[];
    highFanOutFiles: { file: string; importCount: number }[];
    highFanInFiles: { file: string; importedByCount: number }[];
  };
  apiConsistency: {
    issues: APIConsistencyIssue[];
    restConformanceScore: number;
    duplicateEndpoints: { path: string; files: string[] }[];
  };
  testCoverage: {
    details: TestCoverageDetail[];
    overallCoverageRatio: number;
    untestedCriticalFiles: string[];
  };
  architectureHealth: ArchitectureHealth;
  maintainability: MaintainabilityMetrics;
  aiAgent: {
    providers: string[];
    agentTypes: string[];
    agentRoutes: string[];
    agentServices: string[];
  };
  dependencies: {
    backend: { total: number; production: number; dev: number };
    frontend: { total: number; production: number; dev: number };
  };
  featureCompleteness: FeatureArea[];
  scoring: {
    qualityScore: number;
    maintainabilityScore: number;
    featureCoverageScore: number;
    architectureScore: number;
    securityScore: number;
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  };
}
