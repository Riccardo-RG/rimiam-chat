// Localized push alerts are rendered by the OS when the application is closed.
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AndroidConfig,
  IOSConfig,
  withStringsXml,
  withXcodeProject,
} = require("expo/config-plugins");
const english = require("../assets/locales/en.json");
const italian = require("../assets/locales/it.json");
const key = "rimiam_space_activity";

module.exports = function withNotificationCopy(config) {
  withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: key }, _: english.android[key] }],
      mod.modResults,
    );
    return mod;
  });
  return withXcodeProject(config, async (mod) => {
    const project = mod.modResults;
    const name = IOSConfig.XcodeUtils.getProjectName(
      mod.modRequest.projectRoot,
    );
    const filename = "Localizable.xcstrings";
    const file = path.join(mod.modRequest.platformProjectRoot, name, filename);
    const localizations = Object.fromEntries(
      [
        ["en", english],
        ["it", italian],
      ].map(([lang, copy]) => [
        lang,
        { stringUnit: { state: "translated", value: copy.android[key] } },
      ]),
    );
    await fs.writeFile(
      file,
      JSON.stringify(
        {
          sourceLanguage: "en",
          strings: { [key]: { localizations } },
          version: "1.0",
        },
        null,
        2,
      ),
    );
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: filename,
      groupName: name,
      isBuildFile: true,
      project,
    });
    // The xcode library predates string catalogs and otherwise writes an
    // unknown file type, which copies the JSON instead of compiling it.
    const ref = Object.values(project.pbxFileReferenceSection()).find(
      (item) =>
        typeof item === "object" && item.path?.replaceAll('"', "") === filename,
    );
    if (!ref) throw new Error("String catalog missing from the app target.");
    ref.lastKnownFileType = "text.json.xcstrings";
    return mod;
  });
};
