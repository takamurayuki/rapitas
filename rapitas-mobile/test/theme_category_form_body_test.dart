import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/screens/categories/category_form_screen.dart';
import 'package:rapitas_mobile/screens/themes/theme_form_screen.dart';
import 'package:rapitas_mobile/widgets/color_swatch_picker.dart';

void main() {
  group('buildThemeFormBody', () {
    test('作成時：名前を trim、categoryId は int、空の任意項目は省き null を含めない', () {
      final body = buildThemeFormBody(
        name: '  アプリ  ',
        color: '#8B5CF6',
        categoryId: '3',
        isDevelopment: false,
        workingDirectory: '  ',
        description: '',
      );

      expect(body, {
        'name': 'アプリ',
        'color': '#8B5CF6',
        'categoryId': 3,
        'isDevelopment': false,
      });
      expect(body.values.contains(null), isFalse);
    });

    test('作成時：作業フォルダ・説明があれば送る', () {
      final body = buildThemeFormBody(
        name: 'アプリ',
        categoryId: '1',
        isDevelopment: true,
        workingDirectory: ' /Users/me/app ',
        description: ' 説明 ',
      );

      expect(body['workingDirectory'], '/Users/me/app');
      expect(body['description'], '説明');
      expect(body['isDevelopment'], isTrue);
      expect(body.containsKey('color'), isFalse);
    });

    test('編集時：空にした作業フォルダ・説明は空文字で送る', () {
      final body = buildThemeFormBody(
        name: 'アプリ',
        categoryId: '1',
        isDevelopment: false,
        workingDirectory: '',
        description: null,
        isEdit: true,
      );

      expect(body['workingDirectory'], '');
      expect(body['description'], '');
    });

    test('categoryId が無い・数値でなければキーを省く（null は送らない）', () {
      expect(
        buildThemeFormBody(name: 'a', isDevelopment: false, isEdit: true)
            .containsKey('categoryId'),
        isFalse,
      );
      expect(
        buildThemeFormBody(name: 'a', categoryId: 'x', isDevelopment: false)
            .containsKey('categoryId'),
        isFalse,
      );
    });
  });

  group('buildCategoryFormBody', () {
    test('作成時：空の説明・未設定のモードは省く', () {
      final body = buildCategoryFormBody(
        name: ' 趣味 ',
        color: '#EC4899',
        description: ' ',
        mode: null,
      );

      expect(body, {'name': '趣味', 'color': '#EC4899'});
    });

    test('既知のモードだけ送る', () {
      expect(buildCategoryFormBody(name: 'a', mode: 'both')['mode'], 'both');
      expect(
        buildCategoryFormBody(name: 'a', mode: 'unknown').containsKey('mode'),
        isFalse,
      );
    });

    test('編集時：空にした説明は空文字で送る', () {
      final body = buildCategoryFormBody(name: 'a', description: '', isEdit: true);
      expect(body['description'], '');
    });
  });

  group('color swatch', () {
    test('プリセットにテーマのデフォルト色を含む', () {
      expect(presetSwatchColors, contains(defaultThemeColor));
    });

    test('normalizeSwatchColor は #RRGGBB（大文字）に揃え、6桁以外は null', () {
      expect(normalizeSwatchColor('#8b5cf6'), '#8B5CF6');
      expect(normalizeSwatchColor('8B5CF6'), '#8B5CF6');
      expect(normalizeSwatchColor('#abc'), isNull);
      expect(normalizeSwatchColor(null), isNull);
    });

    test('プリセットに無い既存色は先頭に足して選べるようにする', () {
      expect(swatchColorsFor('#8b5cf6'), presetSwatchColors);
      expect(swatchColorsFor('#123456').first, '#123456');
      expect(swatchColorsFor('#123456').length, presetSwatchColors.length + 1);
      expect(swatchColorsFor(null), presetSwatchColors);
    });
  });

  group('categoriesFromThemes', () {
    test('テーマに埋め込まれたカテゴリを sortOrder 順に重複なく取り出す', () {
      final dev = TaskCategory(id: '1', name: '開発', sortOrder: 0);
      final study = TaskCategory(id: '2', name: '学習', sortOrder: 1);
      final themes = [
        TaskTheme(id: '10', name: 'a', categoryId: '2', category: study),
        TaskTheme(id: '11', name: 'b', categoryId: '1', category: dev),
        TaskTheme(id: '12', name: 'c', categoryId: '1', category: dev),
        TaskTheme(id: '13', name: 'd'),
      ];

      expect(categoriesFromThemes(themes).map((c) => c.id).toList(), ['1', '2']);
    });
  });
}
