import 'package:material_ui/material_ui.dart';
import 'package:intl/intl.dart';

import 'api.dart';
import 'participant_profile.dart';
import 'ui_language.dart';

typedef ChatTimelineBuilder = Widget Function(
  bool compact,
  Map<String, dynamic> photos,
);

String chatDayLabel(BuildContext context, DateTime day, DateTime now) {
  final start = DateTime(now.year, now.month, now.day - (now.weekday - 1));
  final locale = Localizations.localeOf(context).toString();
  final format = !day.isBefore(start) && !day.isAfter(now)
      ? DateFormat.EEEE(locale)
      : day.year == now.year
      ? DateFormat.MMMd(locale)
      : DateFormat.yMMMd(locale);
  return format.format(day);
}

/// A narrow chat column also occurs beside a tool on a large screen.
class ChatTimelineLayout extends StatelessWidget {
  static const wideWidth = 760.0;
  const ChatTimelineLayout({
    super.key,
    required this.api,
    required this.workspace,
    required this.revision,
    required this.builder,
  });
  final RimiamApi api;
  final String workspace;
  final int? revision;
  final ChatTimelineBuilder builder;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (_, bounds) {
      if (bounds.maxWidth < wideWidth || revision == null)
        return builder(true, const {});
      return _WideChat(
        key: ValueKey((api, api.actorId, workspace)),
        api: api,
        workspace: workspace,
        revision: revision!,
        builder: builder,
      );
    },
  );
}

class _WideChat extends StatefulWidget {
  const _WideChat({
    super.key,
    required this.api,
    required this.workspace,
    required this.revision,
    required this.builder,
  });
  final RimiamApi api;
  final String workspace;
  final int revision;
  final ChatTimelineBuilder builder;
  @override
  State<_WideChat> createState() => _WideChatState();
}

class _WideChatState extends State<_WideChat> {
  late Future<Map<String, dynamic>> directory = read();
  Future<Map<String, dynamic>> read() async {
    final actor = widget.api.actorId;
    final uri = Uri(
      path: '/api/v1/identity-photos',
      queryParameters: {'workspace': widget.workspace},
    );
    final result = await widget.api.get(uri.toString());
    return result['actor'] == actor && result['members'] is Map<String, dynamic>
        ? result['members'] as Map<String, dynamic>
        : const {};
  }

  @override
  void didUpdateWidget(_WideChat old) {
    super.didUpdateWidget(old);
    if (old.revision != widget.revision) directory = read();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
    future: directory,
    builder: (_, state) => widget.builder(false, state.data ?? const {}),
  );
}

class ChatAuthor extends StatelessWidget {
  const ChatAuthor({
    super.key,
    required this.name,
    required this.color,
    this.onProfile,
    this.avatar,
  });
  final String name;
  final Color color;
  final VoidCallback? onProfile;
  final IdentityAvatar? avatar;
  @override
  Widget build(BuildContext context) {
    final label = Text(
      name,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context).textTheme.labelLarge
          ?.copyWith(fontWeight: FontWeight.w700, color: color),
    );
    if (onProfile == null) return label;
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Semantics(
        button: true,
        onTap: onProfile,
        label: uiText(context, 'Profilo di {0}', [name]),
        child: ExcludeSemantics(
          child: InkWell(
            onTap: onProfile,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (avatar != null) ...[avatar!, const SizedBox(width: 7)],
                  Flexible(child: label),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
