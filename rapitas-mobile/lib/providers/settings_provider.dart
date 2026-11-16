import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

final themeModeProvider = StateNotifierProvider<ThemeModeNotifier, ThemeMode>((ref) {
  return ThemeModeNotifier();
});

class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.system) {
    _loadThemeMode();
  }

  Future<void> _loadThemeMode() async {
    final prefs = await SharedPreferences.getInstance();
    final mode = prefs.getString('themeMode') ?? 'system';
    state = _parseThemeMode(mode);
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('themeMode', mode.name);
  }

  ThemeMode _parseThemeMode(String mode) {
    switch (mode) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}

/// 音声操作モード（設定の「音声操作モード」）。オンの間、アプリが前面にある限り音声コマンドを聞き取る。
/// 既定はオフ。テーマと同じく SharedPreferences に保存する
final voiceCommandModeProvider = StateNotifierProvider<VoiceCommandModeNotifier, bool>((ref) {
  return VoiceCommandModeNotifier();
});

class VoiceCommandModeNotifier extends StateNotifier<bool> {
  VoiceCommandModeNotifier() : super(false) {
    _load();
  }

  static const String prefsKey = 'voiceCommandMode';

  /// 読み込みより先に切り替えられたら、読み込んだ値で上書きしない
  bool _changed = false;

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(prefsKey) ?? false;
      if (!_changed && mounted) state = saved;
    } catch (_) {
      // 保存先が使えなければ既定（オフ）のまま
    }
  }

  Future<void> setEnabled(bool enabled) async {
    _changed = true;
    if (mounted) state = enabled;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(prefsKey, enabled);
    } catch (_) {
      // 保存できなくても、この起動中は切り替えた値で動く
    }
  }
}

// NOTE: 接続先 URL は connection_provider.dart の connectionSettingsProvider に移した（トークンと一緒に扱うため）。
