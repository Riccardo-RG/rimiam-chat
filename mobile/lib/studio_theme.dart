import 'package:material_ui/material_ui.dart';

enum StudioAccent {
  neutral('Grafite', Color(0xff282b27), Color(0xffeeeee8)),
  ocean('Oceano', Color(0xff255486), Color(0xffa6c7ee)),
  forest('Foresta', Color(0xff285e4b), Color(0xffa0ceba)),
  plum('Prugna', Color(0xff694870), Color(0xffd8b8df));

  const StudioAccent(this.label, this.light, this.dark);
  final String label;
  final Color light, dark;
  Color color(Brightness value) => value == Brightness.dark ? dark : light;
}

ThemeData studioTheme(
  Brightness brightness, {
  StudioAccent accent = StudioAccent.neutral,
}) {
  final dark = brightness == Brightness.dark;
  final canvas = dark ? const Color(0xff222321) : const Color(0xfffdfdfc);
  final text = dark ? const Color(0xffefefeb) : const Color(0xff20211e);
  final secondary = dark ? const Color(0xffc6d3d8) : const Color(0xff43545b);
  final colors =
      ColorScheme.fromSeed(
        seedColor: secondary,
        brightness: brightness,
      ).copyWith(
        surface: canvas,
        primary: accent.color(brightness),
        onSurface: text,
        onPrimary: canvas,
        secondary: secondary,
        onSurfaceVariant: dark
            ? const Color(0xffa5a79f)
            : const Color(0xff646660),
        surfaceContainer: dark
            ? const Color(0xff2e302c)
            : const Color(0xfff1f2ee),
        outlineVariant: dark
            ? const Color(0xff41423e)
            : const Color(0xffdedfd9),
      );
  return ThemeData(
    colorScheme: colors,
    scaffoldBackgroundColor: canvas,
    appBarTheme: AppBarTheme(
      backgroundColor: canvas,
      foregroundColor: text,
      centerTitle: false,
    ),
    dividerColor: colors.outlineVariant,
  );
}

const emmeIcon = AssetImage('assets/emme.png');
const spaceIcon = AssetImage('assets/space.png');

class StudioLoading extends StatelessWidget {
  const StudioLoading({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    liveRegion: true,
    child: ExcludeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/brand.png', width: 40, height: 40),
            const SizedBox(height: 8),
            if (MediaQuery.disableAnimationsOf(context))
              Text(label, style: Theme.of(context).textTheme.bodySmall)
            else
              const SizedBox(
                width: 44,
                child: LinearProgressIndicator(minHeight: 2),
              ),
          ],
        ),
      ),
    ),
  );
}
