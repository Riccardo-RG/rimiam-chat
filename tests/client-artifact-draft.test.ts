import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  ArtifactInformationSelection,
  selectArtifactInformation,
  staleArtifactInformation,
} from "../src/client/artifact-document";
import type { Snapshot } from "../src/client/types";

const original = { id: "information-one", version: 1 };
const information = [
  {
    id: original.id,
    subject: "Beta RIMIAM",
    current_version: 2,
    content: "Beta con quattro Workspace",
  },
] as Snapshot["information"];

it("a refreshed information projection cannot silently upgrade an Artifact selection", () => {
  const selected = [original];
  expect(staleArtifactInformation(selected, information)).toEqual([original]);
  expect(selected).toEqual([{ id: original.id, version: 1 }]);

  const reviewed = selectArtifactInformation(selected, {
    id: original.id,
    version: 2,
  });
  expect(staleArtifactInformation(reviewed, information)).toEqual([]);
  expect(reviewed).toEqual([{ id: original.id, version: 2 }]);
  expect(selected).toEqual([original]);
  expect(staleArtifactInformation(reviewed, [])).toEqual(reviewed);
});

it("the shared editor exposes the retained historical selection and leaves the new version unselected", () => {
  const state = {
    information,
    versions: [
      {
        information_id: original.id,
        version: 1,
        content: "Beta con due Workspace",
      },
    ],
  } as Snapshot;
  const html = renderToStaticMarkup(
    createElement(ArtifactInformationSelection, {
      state,
      selected: [original],
      onChange: () => {},
    }),
  );
  expect(html).toContain("Beta con due Workspace");
  expect(html).toContain("Beta con quattro Workspace");
  expect(html).toContain("Rimuovi riferimento v1");
  expect(html).not.toContain("checked=");
});
