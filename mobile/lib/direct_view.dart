import 'api.dart';

String directPath(String id) =>
    '/api/v1/direct-chats/${Uri.encodeComponent(id)}';
Future<Map<String, dynamic>> readDirect(
  RimiamApi api,
  String id,
  String actor,
) async {
  final view = await api.get(directPath(id));
  if (api.actorId != actor || view['me'] != actor || view['id'] != id)
    throw const ApiError(403, 'DIRECT_ACCESS_CHANGED');
  return view;
}

bool directDenied(Object e) =>
    e is ApiError && [401, 403, 404].contains(e.status);
