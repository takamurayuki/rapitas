# rapitas-mobile

Rapitas のスマホアプリ版（Flutter）。デスクトップ版で動いているバックエンド（rapitas-backend, :3001）に接続して、タスク・エージェント実行・承認をスマホから見る／操作する。エージェントの実行そのものはデスクトップ側で行う。

## デスクトップとの接続

バックエンドは安全のため既定で `127.0.0.1` にしか bind しない（エージェント実行 API はコード実行と同じ権限を持つため）。スマホから繋ぐには次のどちらかを使う。

### おすすめ：Tailscale + HTTPS（外出先からも繋がる）

1. デスクトップとスマホの両方に Tailscale を入れ、同じアカウントでログインする
2. デスクトップの `.env` にトークンを設定してバックエンドを起動し直す

   ```
   RAPITAS_API_TOKEN=<長いランダム文字列>
   ```

   `RAPITAS_BIND_HOST` は設定しなくてよい（下の serve がローカルから中継するため、bind は 127.0.0.1 のまま）。
3. デスクトップで Tailscale の serve を有効にする（Tailscale 1.52 以降の書式）

   ```
   tailscale serve --bg 3001
   ```

4. アプリの「設定 → デスクトップとの接続」に、表示された `https://<マシン名>.<tailnet>.ts.net` と同じトークンを入れる

HTTPS なので、iOS / Android のリリースビルドでもそのまま繋がる。

### 開発用：同じ LAN / Tailscale の IP に http で直接

```
RAPITAS_BIND_HOST=0.0.0.0        # または Tailscale の IP
RAPITAS_API_TOKEN=<長いランダム文字列>
```

両方そろわないとバックエンドは 127.0.0.1 に戻る。アプリには `http://<IP>:3001` とトークンを入れる。平文の http は Android では debug ビルドでのみ許可している。

## 開発

Flutter の版は `.fvmrc` で固定している（[FVM](https://fvm.app/)）。GitHub Actions と Xcode Cloud も同じファイルを読むので、ローカルでも `fvm flutter` を使う。

```
fvm install
fvm flutter pub get
fvm flutter test
fvm flutter run
```

版を上げるときは `fvm use <version>` で `.fvmrc` を書き換え、`fvm flutter pub get` で更新した `pubspec.lock` と一緒にコミットする。IDE は `.fvm/flutter_sdk` を SDK に指定する。

- トークンは flutter_secure_storage、URL は shared_preferences に保存する
- REST・SSE ともに `Authorization: Bearer <token>` を付ける（`lib/config/api_config.dart`）
- SSE は `lib/services/sse_service.dart`。切断時は 1秒→30秒の指数バックオフで再接続し、ping が 150 秒届かなければ張り直す
- 届いたイベントで読み直す一覧の対応は `lib/providers/realtime_refresh_provider.dart`
