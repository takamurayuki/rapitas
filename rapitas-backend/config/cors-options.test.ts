/**
 * cors-options ユニットテスト
 *
 * オリジン解決と、クロスオリジンのフロントへ公開するヘッダを固定する。
 *
 * exposeHeaders は「間違っていても何も起きない」種類の設定で、漏れると
 * フロント(:3000)は :3001 の応答ヘッダを読めず、依存する機能が静かに無効化
 * される（#1336 の X-Server-Cursor）。だからここで固定する。
 */
import { describe, test, expect } from 'bun:test';
import {
  ALLOWED_REQUEST_HEADERS,
  buildCorsOptions,
  DEFAULT_CORS_ORIGINS,
  EXPOSED_RESPONSE_HEADERS,
  resolveCorsOrigins,
} from './cors-options';

describe('resolveCorsOrigins', () => {
  test('未設定なら既定のオリジン一覧を返すこと', () => {
    expect(resolveCorsOrigins(undefined)).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  test('カンマ区切りを分解し、前後の空白を落とすこと', () => {
    expect(resolveCorsOrigins(' https://a.example , https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  test('空要素を落とすこと', () => {
    expect(resolveCorsOrigins('https://a.example,,')).toEqual(['https://a.example']);
  });

  // #1336: middleware/local-auth.ts が持っていた複製はここが違っていた。
  // 空文字を分解すると [''] になり length 1 なので「設定あり」と判定され、
  // 許可オリジンが空文字1件になる = 正当なリクエストを全部拒否する。
  // 複製を消してこちらに寄せたので、その差分を固定しておく。
  test('空文字の CORS_ORIGIN は未設定として既定に落ちること', () => {
    expect(resolveCorsOrigins('')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  test('カンマだけの CORS_ORIGIN でも空文字を許可オリジンにしないこと', () => {
    expect(resolveCorsOrigins(',,')).not.toContain('');
  });

  // credentials:true と併用したワイルドカードは、任意のサイトに認証済み応答を
  // 読ませる。起動時に落ちるべきで、黙って出荷されてはいけない。
  test.each(['*', 'null', 'https://a.example,*', '  null  '])(
    'オリジンに %p が含まれていたら投げること',
    (raw) => {
      expect(() => resolveCorsOrigins(raw)).toThrow(/must not contain/);
    },
  );
});

describe('buildCorsOptions', () => {
  test('X-Server-Cursor を exposeHeaders に含めること', () => {
    // これが無いとフロントはヘッダを読めず、全量取得のカーソルが端末時計に
    // 戻る（= #1336 の修正が無言で効かなくなる）。
    expect(buildCorsOptions(undefined).exposeHeaders).toContain('X-Server-Cursor');
  });

  test('X-Rapitas-Source を allowedHeaders に含めること', () => {
    // プリフライトで剥がされると UI-quiet 再起動ゲートが効かなくなる（#570）。
    expect(buildCorsOptions(undefined).allowedHeaders).toContain('X-Rapitas-Source');
  });

  test('credentials を有効にし、オリジンはワイルドカードでないこと', () => {
    const opts = buildCorsOptions(undefined);

    expect(opts.credentials).toBe(true);
    expect(opts.origin).not.toContain('*');
  });

  test('公開ヘッダ・許可ヘッダの一覧をそのまま載せること', () => {
    const opts = buildCorsOptions('https://a.example');

    expect(opts.exposeHeaders).toEqual([...EXPOSED_RESPONSE_HEADERS]);
    expect(opts.allowedHeaders).toEqual([...ALLOWED_REQUEST_HEADERS]);
    expect(opts.origin).toEqual(['https://a.example']);
  });

  test('プリフライトのキャッシュ上限を維持すること', () => {
    // 5s 既定だとポーリングGETで OPTIONS がほぼ毎回再発行される（#570）。
    expect(buildCorsOptions(undefined).maxAge).toBe(7200);
  });
});
