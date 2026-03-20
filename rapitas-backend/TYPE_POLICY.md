# TYPE POLICY — 型定義方針

## 1. 基本原則

### 1.1 any型の禁止
- **厳格禁止**: `any`型の使用は原則として禁止
- **例外のみ**: フレームワーク制約や外部ライブラリの型定義不備による場合のみ、明示的なコメント付きで許可
- **代替手法**: `unknown`、Union型、ジェネリクス、型アサーションを活用

### 1.2 型安全性の優先
- コンパイル時の型チェックを最大限活用
- ランタイムエラーの予防を型レベルで実現
- 型の厳密性 > 記述の簡便性

## 2. 型定義の指針

### 2.1 再利用可能な型定義
```typescript
// ✅ Good: 共通の型定義を作成
interface RequestBody {
  title: string;
  description?: string;
}

// ❌ Bad: インライン型やanyの使用
const handler = (body: any) => { ... }
```

### 2.2 型定義の配置
- **共通型**: `types/` ディレクトリに配置
- **ドメイン固有型**: 各モジュール内に定義
- **API型**: ルートハンドラと同一ファイルまたは `types/api/` に配置

### 2.3 命名規則

| 種類 | 規則 | 例 |
|-----|------|-----|
| Interface | PascalCase + Interface suffix | `TaskInterface`, `UserInterface` |
| Type alias | PascalCase + Type suffix | `StatusType`, `ConfigType` |
| Enum | PascalCase | `TaskStatus`, `UserRole` |
| Generic | 単一大文字 | `T`, `K`, `V` |

## 3. any型の許可例外

### 3.1 フレームワーク制約
```typescript
// ✅ 許可: Elysia global.d.ts
interface Context {
  request: any; // フレームワーク制約
}
```

### 3.2 動的JSON処理
```typescript
// ✅ 許可: 外部APIの動的レスポンス（コメント必須）
const response: Record<string, any> = await fetchDynamicAPI(); // HACK(agent): 動的JSON構造のため
```

### 3.3 テスト用モック
```typescript
// ✅ 許可: テスト環境でのモック（型付き代替を推奨）
const mockFunction = jest.fn() as any; // HACK(agent): Jest型制約回避
```

## 4. 推奨パターン

### 4.1 リクエストボディの型定義
```typescript
// ✅ Good
interface CreateTaskRequest {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
}

app.post('/tasks', ({ body }: { body: CreateTaskRequest }) => {
  // 型安全な処理
});

// ❌ Bad
app.post('/tasks', ({ body }) => {
  const taskData = body as any;
});
```

### 4.2 エラーハンドリング
```typescript
// ✅ Good
try {
  // 処理
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
}

// ❌ Bad
try {
  // 処理
} catch (error: any) {
  console.log(error.message); // 型安全性なし
}
```

### 4.3 外部ライブラリの型拡張
```typescript
// ✅ Good: 型定義ファイルで拡張
declare module 'external-library' {
  export interface LibraryOptions {
    newOption: string;
  }
}

// ❌ Bad: anyでキャスト
const options = libraryOptions as any;
```

## 5. 型チェックの徹底

### 5.1 コンパイル時チェック
```bash
# 厳格な型チェック
tsc --noEmit --strict --noImplicitAny
```

### 5.2 実行時検証
```typescript
// ✅ Good: ランタイム型ガード
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

if (isString(data.title)) {
  // 型安全な処理
}
```

## 6. 段階的移行

### 6.1 既存コードの修正優先度
1. **高**: ルートハンドラのリクエスト/レスポンス型
2. **中**: ビジネスロジックの内部型
3. **低**: テストコードの型（機能に影響しない範囲）

### 6.2 移行戦略
- 小さなスコープから段階的に修正
- 破壊的変更を避ける漸進的改善
- テストカバレッジを保ちながら型安全性を向上

## 7. レビュー基準

### 7.1 必須チェック項目
- [ ] `any`型の使用がないか
- [ ] 型定義が再利用可能な形になっているか
- [ ] 型の命名規則に従っているか
- [ ] `unknown`を使用すべき箇所で`any`を使っていないか

### 7.2 推奨チェック項目
- [ ] 型ガードが適切に実装されているか
- [ ] ジェネリクスが効果的に活用されているか
- [ ] 型定義が過度に複雑になっていないか

このポリシーに従い、プロジェクト全体の型安全性を向上させていきます。