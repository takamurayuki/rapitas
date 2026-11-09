import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../providers/connection_provider.dart';
import '../../providers/pairing_provider.dart';
import '../../services/pairing/pairing_payload.dart';
import '../../services/pairing/pairing_service.dart';
import '../../widgets/voice_mode_indicator.dart';

/// デスクトップの「スマホを追加する」に出る QR コードを読み取り、ペアリングする画面。
/// 成功すると接続先とトークンを保存して閉じる（戻り値 true）。
class PairingScannerScreen extends ConsumerStatefulWidget {
  const PairingScannerScreen({super.key});

  @override
  ConsumerState<PairingScannerScreen> createState() => _PairingScannerScreenState();
}

class _PairingScannerScreenState extends ConsumerState<PairingScannerScreen> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _busy = false;
  String? _message;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy) return;
    final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
    if (raw == null) return;

    final PairingPayload payload;
    try {
      payload = PairingPayload.parse(raw);
    } on FormatException catch (e) {
      setState(() => _message = e.message);
      return;
    }

    setState(() {
      _busy = true;
      _message = '${payload.desktopName} に接続しています…';
    });
    await _controller.stop();
    try {
      final result = await ref
          .read(pairingServiceProvider)
          .pair(payload, deviceName: Platform.isIOS ? 'iPhone' : 'Android');
      await ref.read(connectionSettingsProvider.notifier).savePairing(result);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${result.desktopName} とつながりました'), backgroundColor: Colors.green),
      );
      Navigator.of(context).pop(true);
    } on PairingException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _message = e.message;
      });
      await _controller.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('デスクトップとつなぐ'), actions: const [VoiceModeIndicator()]),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: _onDetect,
                  errorBuilder: (context, error) => const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'カメラを使えません。設定アプリで Rapitas Mobile のカメラを許可してください。',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ),
                if (_busy) const CircularProgressIndicator(),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              _message ??
                  'パソコンの Rapitas で「設定 → 一般 → スマホと連携」を開き、'
                      '「スマホを追加する」で表示された QR コードを読み取ってください。'
                      'スマホとパソコンを同じ Wi-Fi につないでおく必要があります。',
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}
