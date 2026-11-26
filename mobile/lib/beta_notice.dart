import 'package:material_ui/material_ui.dart';

import 'beta_rule_identity.dart';
import 'ui_language.dart';

class BetaNotice extends StatelessWidget {
  const BetaNotice({super.key, required this.version, required this.source});
  final String version;
  final String source;

  @override
  Widget build(BuildContext context) {
    if (version != publishedBetaVersion || source != publishedBetaText) {
      return SelectableText(source);
    }
    final reading = uiText(context, publishedBetaText);
    if (reading == source) return SelectableText(source);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SelectableText(reading),
        ExpansionTile(
          title: Text(uiText(context, 'Testo originale in italiano')),
          children: [SelectableText(source)],
        ),
      ],
    );
  }
}
