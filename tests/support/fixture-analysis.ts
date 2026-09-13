import type { AnalysisSpecialist } from "../../src/server/analysis-specialist";
// Test-only deterministic port; never imported into ordinary application runtime.
export const fixtureAnalysis: AnalysisSpecialist = {
  name: "fixture-analysis",
  async analyze(input) {
    const source = input.inputs.find(
      (i) =>
        i.kind === "source" && !/^(?:miriam[, ]+)?analizza/i.test(i.content),
    );
    if (!source)
      return {
        body: "",
        citations: [],
        needsMore: [],
        needsInput: "Servono fonti condivise pertinenti per il brief.",
      };
    return {
      body: `Brief di verifica: ${source.content}\nIpotesi conservate: ${input.contract.anchors.join("; ")}\nContribution non adottata.`,
      citations: [source.key],
      needsMore: [],
      needsInput: "",
    };
  },
};
