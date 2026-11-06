import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import 'service_providers.dart';

final taskListProvider = FutureProvider.family<List<Task>, TaskFilter>((ref, filter) async {
  final service = ref.watch(taskServiceProvider);
  return service.getTasks(
    status: filter.status,
    priority: filter.priority,
    themeId: filter.themeId,
    projectId: filter.projectId,
  );
});

final taskDetailProvider = FutureProvider.family<Task, String>((ref, id) async {
  final service = ref.watch(taskServiceProvider);
  return service.getTask(id);
});

final taskFilterProvider = StateProvider<TaskFilter>((ref) => const TaskFilter());

class TaskFilter {
  final String? status;
  final String? priority;
  final String? themeId;
  final String? projectId;

  const TaskFilter({this.status, this.priority, this.themeId, this.projectId});

  TaskFilter copyWith({
    String? status,
    String? priority,
    String? themeId,
    String? projectId,
    bool clearStatus = false,
    bool clearPriority = false,
    bool clearThemeId = false,
    bool clearProjectId = false,
  }) {
    return TaskFilter(
      status: clearStatus ? null : (status ?? this.status),
      priority: clearPriority ? null : (priority ?? this.priority),
      themeId: clearThemeId ? null : (themeId ?? this.themeId),
      projectId: clearProjectId ? null : (projectId ?? this.projectId),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TaskFilter &&
          status == other.status &&
          priority == other.priority &&
          themeId == other.themeId &&
          projectId == other.projectId;

  @override
  int get hashCode => Object.hash(status, priority, themeId, projectId);
}
