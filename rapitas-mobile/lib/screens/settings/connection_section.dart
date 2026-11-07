import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/connection_provider.dart';
import '../../providers/pairing_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/sse_service.dart';
import '../pairing/pairing_scanner_screen.dart';

/// 設定画面の「デスクトップとの接続」欄。接続先・トークン・リアルタイム接続の状態・接続テストを扱う。
class ConnectionSection extends ConsumerWidget {
  const ConnectionSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(connectionSettingsProvider);
    final sseState = ref.watch(sseConnectionStateProvider).valueOrNull ?? SseConnectionState.idle;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          leading: const Icon(Icons.qr_code_scanner),
          title: Text(settings.isPaired ? '${settings.desktopName ?? 'デスクトップ'} とつながっています' : 'QRコードでデスクトップとつなぐ'),
          subtitle: Text(settings.isPaired ? '別のデスクトップにつなぐときも、ここから読み取ります' : 'パソコンの「設定 → 一般 → スマホと連携」に出るQRコードを読み取ります'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<bool>(builder: (_) => const PairingScannerScreen()),
          ),
        ),
        if (settings.isPaired)
          ListTile(
            leading: const Icon(Icons.travel_explore),
            title: const Text('デスクトップを探し直す'),
            subtitle: const Text('パソコンの IP アドレスが変わってつながらないとき'),
            onTap: () => _rediscover(context, ref),
          ),
        ListTile(
          leading: const Icon(Icons.link),
          title: const Text('接続先'),
          subtitle: Text(settings.baseUrl),
          trailing: const Icon(Icons.edit),
          onTap: () => showConnectionDialog(context, ref, settings),
        ),
        ListTile(
          leading: const Icon(Icons.key),
          title: const Text('APIトークン'),
          subtitle: Text(settings.hasToken ? '設定済み' : '未設定（同じPCからの接続のみ）'),
          trailing: const Icon(Icons.edit),
          onTap: () => showConnectionDialog(context, ref, settings),
        ),
        ListTile(
          leading: Icon(_stateIcon(sseState), color: _stateColor(context, sseState)),
          title: const Text('リアルタイム接続'),
          subtitle: Text(sseStateLabel(sseState)),
          trailing: sseState == SseConnectionState.unauthorized || sseState == SseConnectionState.reconnecting
              ? TextButton(
                  onPressed: () => ref.invalidate(sseServiceProvider),
                  child: const Text('再接続'),
                )
              : null,
        ),
        ListTile(
          leading: const Icon(Icons.wifi),
          title: const Text('接続テスト'),
          trailing: const Icon(Icons.play_arrow),
          onTap: () => _testConnection(context, ref),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text(
            '接続先とトークンを手入力するのは、QRコードを使えないとき（VPN 経由など）だけで構いません。'
            '手入力すると、QRコードでつないだ情報は消えます。',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ),
      ],
    );
  }

  Future<void> _rediscover(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final settings = ref.read(connectionSettingsProvider);
    if (!settings.isPaired) return;
    messenger.showSnackBar(const SnackBar(content: Text('同じ Wi-Fi のデスクトップを探しています…')));
    final url = await ref.read(desktopDiscoveryProvider).findBaseUrl(settings.desktopId!);
    messenger.clearSnackBars();
    if (url == null) {
      messenger.showSnackBar(const SnackBar(
        content: Text('見つかりませんでした。パソコンで「スマホと連携」がオンになっているか、同じ Wi-Fi か確認してください'),
        backgroundColor: Colors.red,
      ));
      return;
    }
    await ref.read(connectionSettingsProvider.notifier).updateDiscoveredUrl(url);
    messenger.showSnackBar(SnackBar(content: Text('見つかりました（$url）'), backgroundColor: Colors.green));
  }

  Future<void> _testConnection(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).get('/settings');
      messenger.showSnackBar(const SnackBar(content: Text('接続できました'), backgroundColor: Colors.green));
    } catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(connectionErrorMessage(error)), backgroundColor: Colors.red));
    }
  }
}

/// 接続先とトークンを編集するダイアログを開く。
///
/// @param settings - いまの接続設定 / 現在値
Future<void> showConnectionDialog(BuildContext context, WidgetRef ref, ConnectionSettings settings) {
  final urlController = TextEditingController(text: settings.baseUrl);
  final tokenController = TextEditingController();
  var obscure = true;

  return showDialog<void>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('デスクトップとの接続'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: urlController,
              decoration: const InputDecoration(labelText: '接続先URL', hintText: 'http://100.64.0.1:3001'),
              keyboardType: TextInputType.url,
              autocorrect: false,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: tokenController,
              obscureText: obscure,
              autocorrect: false,
              enableSuggestions: false,
              decoration: InputDecoration(
                labelText: 'APIトークン',
                // 保存済みのトークンは表示しない。空のまま保存すれば今の値を残す
                hintText: settings.hasToken ? '変更しない場合は空のまま' : 'RAPITAS_API_TOKEN の値',
                suffixIcon: IconButton(
                  icon: Icon(obscure ? Icons.visibility : Icons.visibility_off),
                  onPressed: () => setState(() => obscure = !obscure),
                ),
              ),
            ),
          ],
        ),
        actions: [
          if (settings.hasToken)
            TextButton(
              onPressed: () async {
                await ref.read(connectionSettingsProvider.notifier).save(baseUrl: urlController.text, apiToken: '');
                if (context.mounted) Navigator.pop(context);
              },
              child: const Text('トークンを削除'),
            ),
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('キャンセル')),
          FilledButton(
            onPressed: () async {
              final url = urlController.text.trim();
              if (url.isEmpty) return;
              final token = tokenController.text.trim();
              await ref.read(connectionSettingsProvider.notifier).save(
                    baseUrl: url,
                    apiToken: token.isEmpty ? null : token,
                  );
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('保存'),
          ),
        ],
      ),
    ),
  );
}

/// 接続エラーを利用者向けの日本語にする。
///
/// @param error - API 呼び出しの例外 / 発生したエラー
/// @returns 表示用メッセージ / エラーメッセージ
String connectionErrorMessage(Object error) {
  if (error is DioException) {
    final status = error.response?.statusCode;
    if (status == 401 || status == 403) return 'このスマホの接続が解除されたか、トークンが違います。QRコードでつなぎ直してください';
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.connectionError:
        return 'デスクトップに届きません。同じ Wi-Fi か、パソコンで「スマホと連携」がオンかを確認してください';
      default:
        if (status != null) return '接続できませんでした（HTTP $status）';
    }
  }
  return '接続できませんでした';
}

/// リアルタイム接続の状態ラベル
String sseStateLabel(SseConnectionState state) {
  switch (state) {
    case SseConnectionState.idle:
      return '未接続';
    case SseConnectionState.connecting:
      return '接続中…';
    case SseConnectionState.connected:
      return '接続済み';
    case SseConnectionState.reconnecting:
      return '切断されました。再接続を待っています';
    case SseConnectionState.unauthorized:
      return '接続が解除されたかトークンが違うため、つながりません。QRコードでつなぎ直してください';
  }
}

IconData _stateIcon(SseConnectionState state) {
  switch (state) {
    case SseConnectionState.connected:
      return Icons.cloud_done;
    case SseConnectionState.unauthorized:
      return Icons.lock_outline;
    case SseConnectionState.idle:
    case SseConnectionState.connecting:
    case SseConnectionState.reconnecting:
      return Icons.cloud_off;
  }
}

Color _stateColor(BuildContext context, SseConnectionState state) {
  switch (state) {
    case SseConnectionState.connected:
      return Colors.green;
    case SseConnectionState.unauthorized:
      return Theme.of(context).colorScheme.error;
    default:
      return Colors.orange;
  }
}
