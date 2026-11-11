import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'voice_command_flow.dart';

// 音声操作モードの常時聞き取りの型（聞き取り表示の状態と、画面側に頼むことの口）。
// 実装は voice_mode_listener.dart（そこから export しているので、使う側は従来どおり listener を import すればよい）。

/// 聞き取り表示に出す状態（受付の状態だけ。直前の結果「コマンドではなかった」は [VoiceModeListener.recentlyIgnored]）
///
/// NOTE: 2026-11-11 の見直し（gaps-design §5・§8）で、受付可能かどうかを取り違えないよう分けた：
/// 旧 listening は「開始待ち・張り直し待ち」も含んでいた → [preparing] と [ready] に分割。
/// 旧 working は「処理中」と「シートが答えを待っている」を兼ねていた → [processing] と [awaiting] に分割。
/// 旧 ignored は受付状態ではないので状態から外した（表示は「話せます」に戻る）。
enum VoiceModeStatus {
  /// モードがオフ（表示しない）
  off,

  /// モードはオンだが止めている（キーボード・入力欄・チャットのマイク・背面）
  paused,

  /// 聞き取りの開始待ち・張り直し待ち（まだ受け付けていない。受付可能とは見せない）
  preparing,

  /// 話せます：聞き取りの開始に成功し、まだ言葉が届いていない
  ready,

  /// 声を受け取り中：いまの聞き取りに言葉が届いている（常時聞き取り・コマンドシートのどちらでも）
  hearing,

  /// 処理中：コマンドを実行している（取得・更新・画面の操作）
  processing,

  /// 回答待ち：コマンドシートが選択・確認・項目・次のコマンドを待っている
  awaiting,

  /// 聞き取りを始められない・始めてもすぐ失敗で終わる（端末側の不調。少し待って張り直す）
  unavailable,
}

/// 常時聞き取りが画面に頼むこと
abstract class VoiceModeBinding {
  /// いま表示している画面のパス
  String currentPath();

  /// コマンドの実行に使うプロバイダの入れ物
  ProviderContainer get container;

  /// 画面の操作（移動・スナックバーなど）
  VoiceUi createUi();

  /// コマンドシートを開く（[initialText] があればその文の解釈から続ける）。閉じたら完了する
  Future<void> openSheet(String path, {String? initialText});

  /// 聞き取りの権限が無くなっていた（モードをオフにして理由を出す）
  void onPermissionLost();
}
