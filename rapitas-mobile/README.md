# rapitas-mobile

Rapitas のスマホアプリ版（Flutter）。デスクトップ版で動いているバックエンド（rapitas-backend）に接続して、タスク・エージェント実行・承認・ラピとのチャットをスマホから見る／操作する。エージェントの実行そのものはデスクトップ側で行う。

## デスクトップとの接続

バックエンドの本体 API（:3001）は安全のため既定で `127.0.0.1` にしか bind しない（エージェント実行 API はコード実行と同じ権限を持つため）。スマホから繋ぐ方法は次の 3 つ。

| 方法 | 使う場面 | スマホの接続先 | トークン |
| --- | --- | --- | --- |
| QR ペアリング | 同じ Wi-Fi にいるとき | デスクトップのスマホ連携用ゲートウェイ（既定ポート 3002） | ペアリングで受け取る端末専用トークン |
| Tailscale + HTTPS | 外出先からも繋ぎたいとき | `https://<マシン名>.<tailnet>.ts.net` | `RAPITAS_API_TOKEN` |
| LAN / Tailscale の IP に http | 開発用 | `http://<IP>:3001` | `RAPITAS_API_TOKEN` |

### QR ペアリング（同じ Wi-Fi）

1. デスクトップの設定で「スマホと連携」をオンにし、ペアリング用の QR コードを表示する
2. アプリの「設定 → デスクトップとの接続」から QR コードを読み取る（`lib/screens/pairing/pairing_scanner_screen.dart`）
3. アプリは QR に入っている LAN アドレスを順に試し、デスクトップから端末専用のトークンを受け取って保存する

QR コードには有効期限があり、一度しか使えない。期限切れや使用済みのときは、デスクトップで新しい QR コードを表示する。

ペアリング後にデスクトップの IP アドレスが変わっても、アプリは起動時とリアルタイム接続が切れたときに LAN 上で mDNS（`_rapitas._tcp`）を使ってペアリングした相手を探し直し、見つかれば接続先を更新する（`lib/services/pairing/desktop_discovery.dart`）。設定画面の「デスクトップを探し直す」で手動でも探せる。ゲスト Wi-Fi などマルチキャストが通らないネットワークでは見つからない。

> [!NOTE]
> ペアリングは平文の http で通信する。iOS はローカルネットワーク宛てを許可しているが、Android は平文の http を debug ビルドでしか許可していないため、Android のリリースビルドでは QR ペアリングで繋がらない。

### Tailscale + HTTPS（外出先からも繋がる）

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

接続先を手入力で保存すると、QR ペアリングの相手の情報は消える（手入力の接続先がその相手とは限らないため）。

## 開発

Flutter の版は `.fvmrc` で固定している（[FVM](https://fvm.app/)）。GitHub Actions と Xcode Cloud も同じファイルを読むので、ローカルでも `fvm flutter` を使う。

```
fvm install
fvm flutter pub get
fvm flutter test
fvm flutter run
```

版を上げるときは `fvm use <version>` で `.fvmrc` を書き換え、`fvm flutter pub get` で更新した `pubspec.lock` と一緒にコミットする。IDE は `.fvm/flutter_sdk` を SDK に指定する。

- トークン（手入力した `RAPITAS_API_TOKEN` またはペアリングで受け取った端末専用トークン）は flutter_secure_storage、URL とペアリングしたデスクトップの ID・名前は shared_preferences に保存する（`lib/providers/connection_provider.dart`）
- REST・SSE ともに `Authorization: Bearer <token>` を付ける（`lib/config/api_config.dart`）
- SSE は `lib/services/sse_service.dart`。切断時は 1秒→30秒の指数バックオフで再接続し、ping を含むイベントが 150 秒届かなければ張り直す
- 届いたイベントで読み直す一覧の対応は `lib/providers/realtime_refresh_provider.dart`
- アプリの構成・呼んでいる API・開発ルールは `CLAUDE.md` を参照
