// franks-motion-builder.ts — Franks v. Delaware Challenge Builder
// Purpose: Construct structured argument output for a Franks suppression motion.
//          Challenges warrant affidavit statements shown to be materially false
//          or made with reckless disregard for truth, using Five9 call records
//          as the primary contradicting evidence source.
//
// Legal standard: Franks v. Delaware, 438 U.S. 154 (1978)
//   — Defendant may challenge warrant affidavit by proving deliberate falsehood
//     or reckless disregard for truth by the affiant. If false material is
//     excised and probable cause then fails, warrant is void and evidence
//     obtained thereunder must be suppressed.
//
// Case: United States v. Redmond, 5:24-cr-00376 (E.D. Pa., Schmehl, J.)
//
// [DRAFT ONLY — NOT FOR FILING — ATTORNEY REVIEW REQUIRED BEFORE ANY COURT USE]

export type FalsehoodType = "deliberate" | "reckless";

export interface FranksChallenge {
  affidavitStatement: string;  // Exact or paraphrased claim in the warrant affidavit
  actualEvidence: string;      // What the Five9 records / other evidence actually shows
  falsehoodType: FalsehoodType; // Standard under Franks: deliberate or reckless
  materiality: string;         // Why excising this statement destroys probable cause
  evidenceSource: string;      // Specific Five9 recording or exhibit ID contradicting claim
}

export interface FranksMotionOutput {
  caseCaption: string;
  draftWarning: string;
  challenges: FranksChallenge[];
  probableCauseAnalysis: string;
  suppressionRequest: string;
  exhibitList: string[];
  generatedAt: string;
}

/**
 * Build structured Franks v. Delaware challenge argument output.
 * Does NOT draft final court language — produces structured analysis only.
 * All output is DRAFT and requires attorney review before any use.
 *
 * @param challenges   Array of affidavit challenges with supporting evidence
 * @param caseNumber   EDPA criminal docket number (default: 5:24-cr-00376)
 * @returns            Structured motion framework marked DRAFT ONLY
 */
export async function buildFranksMotion(
  challenges: FranksChallenge[],
  caseNumber: string = "5:24-cr-00376"
): Promise<FranksMotionOutput> {
  if (challenges.length === 0) {
    throw new Error("[franks-builder] No challenges provided — nothing to build.");
  }

  const output: FranksMotionOutput = {
    caseCaption: `UNITED STATES v. REDMOND, ${caseNumber} (E.D. Pa., Schmehl, J.)`,
    draftWarning:
      "[DRAFT ONLY — NOT FOR FILING — ATTORNEY REVIEW REQUIRED. " +
      "This output does not constitute legal advice and must be reviewed " +
      "by licensed counsel before any court submission.]",
    challenges,
    probableCauseAnalysis: buildPCAnalysis(challenges),
    suppressionRequest: buildSuppressionRequest(challenges),
    exhibitList: [...new Set(challenges.map((c) => c.evidenceSource).filter(Boolean))],
    generatedAt: new Date().toISOString(),
  };

  console.log(
    `[franks-builder] built ${challenges.length} challenges for ${caseNumber}`
  );

  return output;
}

/**
 * Construct the probable cause excision analysis under Franks.
 * Walks each challenge, identifies type, and frames the PC-after-excision test.
 */
function buildPCAnalysis(challenges: FranksChallenge[]): string {
  const deliberate = challenges.filter((c) => c.falsehoodType === "deliberate");
  const reckless = challenges.filter((c) => c.falsehoodType === "reckless");

  const lines: string[] = [
    "PROBABLE CAUSE ANALYSIS — FRANKS v. DELAWARE CHALLENGE",
    "========================================================",
    "",
    "Legal Standard:",
    "Under Franks v. Delaware, 438 U.S. 154 (1978), when a defendant",
    "makes a substantial preliminary showing that the affiant deliberately",
    "or recklessly included false statements in a warrant affidavit, the",
    "court must hold a Franks hearing. If the false material is set aside",
    "and the remaining content is insufficient to establish probable cause,",
    "the warrant must be voided and the fruits suppressed. See Franks, 438",
    "U.S. at 155-56; United States v. Calisto, 838 F.2d 711 (3d Cir. 1988).",
    "",
    `Deliberate falsehoods identified: ${deliberate.length}`,
    `Reckless disregard statements: ${reckless.length}`,
    `Total challenges: ${challenges.length}`,
    "",
    "Per-Challenge Analysis:",
    "------------------------",
  ];

  challenges.forEach((c, i) => {
    lines.push(
      "",
      `Challenge ${i + 1} — ${c.falsehoodType.toUpperCase()}`,
      `Affidavit claimed: "${c.affidavitStatement}"`,
      `Evidence shows:    ${c.actualEvidence}`,
      `Evidence source:   ${c.evidenceSource}`,
      `Materiality:       ${c.materiality}`
    );
  });

  lines.push(
    "",
    "Probable Cause After Excision:",
    "If the above statements are excised per Franks, the residual affidavit",
    "must be evaluated for sufficiency. Each materiality entry above explains",
    "why excision of that statement removes a necessary pillar of probable",
    "cause. Where multiple pillars are removed, the cumulative effect is",
    "fatal to the warrant.",
    ""
  );

  return lines.join("\n");
}

/**
 * Build the relief request section of the motion framework.
 */
function buildSuppressionRequest(challenges: FranksChallenge[]): string {
  return [
    "REQUESTED RELIEF",
    "================",
    "",
    "WHEREFORE, defendant respectfully requests that this Court:",
    "",
    "1. Hold a Franks evidentiary hearing at which the affiant is",
    "   subject to examination regarding each statement identified above;",
    "",
    "2. Strike all false and misleading statements from the warrant affidavit",
    `   (${challenges.length} challenge(s) identified herein);`,
    "",
    "3. Evaluate the residual affidavit content for probable cause sufficiency",
    "   without the excised material;",
    "",
    "4. Void the warrant and suppress all evidence obtained thereunder,",
    "   including any derivative evidence ('fruit of the poisonous tree'),",
    "   Wong Sun v. United States, 371 U.S. 471 (1963).",
    "",
    "",
    "[DRAFT ONLY — NOT FOR FILING — ATTORNEY REVIEW REQUIRED]",
    "[This is a structural framework only. Final motion must be drafted,",
    " verified, and signed by licensed counsel of record.]",
  ].join("\n");
}
