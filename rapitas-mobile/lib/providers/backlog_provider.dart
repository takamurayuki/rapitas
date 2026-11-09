import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/backlog.dart';
import 'service_providers.dart';

final ideaListProvider = FutureProvider<List<Idea>>((ref) async {
  return ref.watch(backlogServiceProvider).getIdeas();
});

final concernListProvider = FutureProvider<List<Concern>>((ref) async {
  return ref.watch(backlogServiceProvider).getConcerns();
});

final hypothesisListProvider = FutureProvider<List<Hypothesis>>((ref) async {
  return ref.watch(backlogServiceProvider).getHypotheses();
});
