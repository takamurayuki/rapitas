import 'package:shared_preferences/shared_preferences.dart';

// 会話スペースの端末側の保存先（SharedPreferences。設計 nav39 4.4・6.4）。
//
// どちらも接続先（ペアリングしたデスクトップの id、無ければ backendUrl）ごとに別のキーに置く。
// 別のデスクトップにつなぎ替えたあとで、前の接続先の会話を新しい接続先へ送らないため。

/// 保存待ちの列のキー
const String rapiPendingSavesKey = 'rapiChatPendingSaves.v1';

/// 最後に開いたスペースのキー（値は `space:<id>` か `local:<uuid>`）
const String rapiLastSpaceKey = 'rapiLastSpaceId.v1';

/// 文字列1つの読み書き（テストでは偽物を使える）
abstract class RapiSaveStore {
  Future<String?> read();
  Future<void> write(String value);
}

/// SharedPreferences の1キー
class PrefsRapiStore implements RapiSaveStore {
  final String key;

  const PrefsRapiStore(this.key);

  /// [base] のキーを、接続先 [connection] 用にしたもの
  factory PrefsRapiStore.forConnection(String base, String connection) =>
      PrefsRapiStore('$base:$connection');

  @override
  Future<String?> read() async => (await SharedPreferences.getInstance()).getString(key);

  @override
  Future<void> write(String value) async {
    final prefs = await SharedPreferences.getInstance();
    if (value.isEmpty || value == '[]') {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, value);
    }
  }
}
