import 'ui_language.dart';

import 'package:material_ui/material_ui.dart';

import 'chat_actions.dart';

class WorkspaceGuide extends StatelessWidget {
  const WorkspaceGuide({
    super.key,
    required this.actions,
    required this.assistant,
  });
  final Iterable<ComposerAction> actions;
  final String assistant;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(uiText(context, 'Guida dello spazio'))),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ExpansionTile(
            title: Text(uiText(context, 'Conversazione')),
            children: [
              ListTile(
                title: Text(
                  uiText(
                    context,
                    'Per coinvolgere {0}, usa il suo simbolo accanto a Invia. Per citare un messaggio, apri il menu del messaggio.',
                    [assistant],
                  ),
                ),
              ),
            ],
          ),
          ExpansionTile(
            title: Text(uiText(context, 'Foto, file e link')),
            children: [
              ListTile(
                title: Text(
                  uiText(
                    context,
                    'Usa la graffetta per allegare. In Condivisi puoi cercare per data o tipo. Dall’anteprima, Vai al messaggio riapre la conversazione nel punto della condivisione.',
                  ),
                ),
              ),
            ],
          ),
          ExpansionTile(
            title: Text(uiText(context, 'Stato dello spazio')),
            children: [
              ListTile(
                title: Text(
                  uiText(
                    context,
                    'Contesto raccoglie i riferimenti accettati. In Direzione trovi l’obiettivo e le decisioni adottate. In programma mostra le attività e chi le segue.',
                  ),
                ),
              ),
            ],
          ),
          ExpansionTile(
            title: Text(uiText(context, 'Area personale')),
            children: [
              ListTile(
                title: Text(
                  uiText(
                    context,
                    'Tu ed Emme, i documenti e i promemoria personali si trovano in Home. Per mostrare un contenuto al gruppo, scegli esplicitamente Condividi.',
                  ),
                ),
              ),
            ],
          ),
          const Divider(),
          Text(
            uiText(context, 'Comandi della chat'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final item in actions)
            ListTile(
              title: Text(item.displayShortcuts(context).join(' · ')),
              subtitle: Text(
                item.displayLabel(context).replaceAll('Emme', assistant),
              ),
            ),
        ],
      ),
    ),
  );
}
