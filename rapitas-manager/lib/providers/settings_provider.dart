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

final backendUrlProvider = StateNotifierProvider<BackendUrlNotifier, String>((ref) {
  return BackendUrlNotifier();
});

class BackendUrlNotifier extends StateNotifier<String> {
  BackendUrlNotifier() : super('http://localhost:3001') {
    _loadUrl();
  }

  Future<void> _loadUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('backendUrl');
    if (url != null) state = url;
  }

  Future<void> setUrl(String url) async {
    state = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('backendUrl', url);
  }
}
