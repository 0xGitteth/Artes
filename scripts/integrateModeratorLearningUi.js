#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const backendPath = path.join(root, 'functions', 'index.js');
const frontendPath = path.join(root, 'src', 'ArtesApp.jsx');

const replaceOnce = (source, target, replacement, label) => {
  const first = source.indexOf(target);
  if (first < 0) throw new Error(`integration_anchor_missing:${label}`);
  if (source.indexOf(target, first + target.length) >= 0) {
    throw new Error(`integration_anchor_not_unique:${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + target.length);
};

const writeIfChanged = (filePath, before, after) => {
  if (before === after) return false;
  fs.writeFileSync(filePath, after, 'utf8');
  return true;
};

const integrateBackend = (source) => {
  let next = source;
  const importLine = "import { buildModeratorDecisionLearningFields } from './moderationModeratorLearningSubmission.js';";
  if (!next.includes(importLine)) {
    const anchor = "import { buildCommonModerationExample } from './moderationExampleBuilder.js';";
    next = replaceOnce(next, anchor, `${anchor}\n${importLine}`, 'backend_import');
  }

  const start = next.indexOf('export const moderatorDecide');
  const end = next.indexOf('export const moderatorQueueFreshEvaluation', start);
  if (start < 0 || end < 0 || end <= start) throw new Error('moderator_decide_section_not_found');

  let section = next.slice(start, end);

  if (!section.includes('const moderatorLearningSubmission = body?.moderatorLearningSubmission ?? null;')) {
    const anchor = '    const body = parseJsonBody(req);\n';
    section = replaceOnce(
      section,
      anchor,
      `${anchor}    const moderatorLearningSubmission = body?.moderatorLearningSubmission ?? null;\n`,
      'moderator_decide_body',
    );
  }

  if (!section.includes('let moderatorLearningFields = {};')) {
    const anchor = '    let moderationExamplePayload = null;\n';
    section = replaceOnce(
      section,
      anchor,
      `${anchor}    let moderatorLearningFields = {};\n`,
      'moderator_learning_fields_declaration',
    );
  }

  if (!section.includes('moderatorLearningFields = buildModeratorDecisionLearningFields({')) {
    const anchor = '        uploadSnapshotData = uploadSnapshot.exists ? (uploadSnapshot.data() || null) : null;\n';
    const insertion = `${anchor}        moderatorLearningFields = buildModeratorDecisionLearningFields({\n          reasonCode: normalizedReasonCode,\n          aiDetectorLabel: uploadSnapshotData?.detectorLabel\n            || uploadSnapshotData?.aiDetectorLabel\n            || uploadSnapshotData?.aiResult?.detectorLabel\n            || reviewSnapshotData?.detectorLabel\n            || reviewSnapshotData?.aiSummary?.detectorLabel\n            || null,\n          submission: moderatorLearningSubmission,\n        });\n`;
    section = replaceOnce(section, anchor, insertion, 'moderator_learning_validation');
  }

  if (!section.includes('...moderatorLearningFields,')) {
    const pattern = /(reasonCode: normalizedReasonCode,\n)(\s*)(correctedTaxonomy:)/g;
    let count = 0;
    section = section.replace(pattern, (_match, reasonLine, indentation, correctedKey) => {
      count += 1;
      return `${reasonLine}${indentation}...moderatorLearningFields,\n${indentation}${correctedKey}`;
    });
    if (count < 1) throw new Error('moderator_learning_decision_object_anchor_missing');
  }

  next = next.slice(0, start) + section + next.slice(end);
  return next;
};

const integrateFrontend = (source) => {
  let next = source;
  const importLine = "import ModeratorLearningEvidenceFields from './components/ModeratorLearningEvidenceFields';";
  if (!next.includes(importLine)) {
    const anchor = "import PrivacyPolicyView from './components/settings/PrivacyPolicyView';";
    next = replaceOnce(next, anchor, `${anchor}\n${importLine}`, 'frontend_import');
  }

  if (!next.includes('const [moderatorLearningSubmission, setModeratorLearningSubmission] = useState(null);')) {
    const anchor = "  const [decisionReasonCode, setDecisionReasonCode] = useState('');\n";
    next = replaceOnce(
      next,
      anchor,
      `${anchor}  const [moderatorLearningSubmission, setModeratorLearningSubmission] = useState(null);\n`,
      'frontend_learning_state',
    );
  }

  if (!next.includes("setDecisionReasonCode('');\n    setModeratorLearningSubmission(null);\n    setQueueFreshEvaluationReasonCode('');")) {
    const anchor = "    setDecisionReasonCode('');\n    setQueueFreshEvaluationReasonCode('');\n";
    next = replaceOnce(
      next,
      anchor,
      "    setDecisionReasonCode('');\n    setModeratorLearningSubmission(null);\n    setQueueFreshEvaluationReasonCode('');\n",
      'frontend_case_reset',
    );
  }

  if (!next.includes("setDecisionReasonCode('');\n    setModeratorLearningSubmission(null);\n  }, [decisionReasonCode, validDecisionReasonCodes]);")) {
    const anchor = "    setDecisionReasonCode('');\n  }, [decisionReasonCode, validDecisionReasonCodes]);\n";
    next = replaceOnce(
      next,
      anchor,
      "    setDecisionReasonCode('');\n    setModeratorLearningSubmission(null);\n  }, [decisionReasonCode, validDecisionReasonCodes]);\n",
      'frontend_reason_reset_effect',
    );
  }

  if (!next.includes('const selectedAiDetectorLabel =')) {
    const anchor = '  const geminiDiagnostics = resolveGeminiDiagnostics(selectedCase, selectedUpload);\n';
    const insertion = `${anchor}  const selectedAiDetectorLabel = selectedUpload?.detectorLabel\n    || selectedUpload?.aiDetectorLabel\n    || selectedUpload?.aiResult?.detectorLabel\n    || selectedCase?.detectorLabel\n    || selectedCase?.aiSummary?.detectorLabel\n    || null;\n`;
    next = replaceOnce(next, anchor, insertion, 'frontend_ai_detector_label');
  }

  if (!next.includes('...(moderatorLearningSubmission ? { moderatorLearningSubmission } : {}),')) {
    const anchor = '          reasonCode: decisionReasonCode,\n';
    next = replaceOnce(
      next,
      anchor,
      `${anchor}          ...(moderatorLearningSubmission ? { moderatorLearningSubmission } : {}),\n`,
      'frontend_submit_payload',
    );
  }

  const oldReasonChange = '                        onChange={(event) => setDecisionReasonCode(event.target.value)}\n';
  if (next.includes(oldReasonChange)) {
    next = replaceOnce(
      next,
      oldReasonChange,
      "                        onChange={(event) => { setDecisionReasonCode(event.target.value); setModeratorLearningSubmission(null); }}\n",
      'frontend_reason_onchange',
    );
  }

  if (!next.includes('<ModeratorLearningEvidenceFields')) {
    const anchor = `                    </div>\n                    <div>\n                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Redenen (max 3)</label>\n`;
    const insertion = `                    </div>\n                    {!isReportCase && (\n                      <ModeratorLearningEvidenceFields\n                        reasonCode={decisionReasonCode}\n                        aiDetectorLabel={selectedAiDetectorLabel}\n                        value={moderatorLearningSubmission}\n                        onChange={setModeratorLearningSubmission}\n                      />\n                    )}\n                    <div>\n                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Redenen (max 3)</label>\n`;
    next = replaceOnce(next, anchor, insertion, 'frontend_learning_component');
  }

  return next;
};

const backendBefore = fs.readFileSync(backendPath, 'utf8');
const frontendBefore = fs.readFileSync(frontendPath, 'utf8');
const backendAfter = integrateBackend(backendBefore);
const frontendAfter = integrateFrontend(frontendBefore);

const backendChanged = writeIfChanged(backendPath, backendBefore, backendAfter);
const frontendChanged = writeIfChanged(frontendPath, frontendBefore, frontendAfter);

console.log(JSON.stringify({
  ok: true,
  backendChanged,
  frontendChanged,
  files: [
    path.relative(root, backendPath),
    path.relative(root, frontendPath),
  ],
}, null, 2));
