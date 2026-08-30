import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEMINI_MODERATION_MODEL,
  GEMINI_MODERATION_PROMPT_VERSION,
  buildGeminiModerationPrompt,
  getGeminiModerationContractIssue,
  getGeminiSafetyBlockReason,
  normalizeGeminiModerationResult,
  parseGeminiModerationJson,
} from '../geminiModerationContract.js';

test('uses the stable Gemini 2.5 Flash moderation default', () => {
  assert.equal(DEFAULT_GEMINI_MODERATION_MODEL, 'gemini-2.5-flash');
  assert.equal(GEMINI_MODERATION_PROMPT_VERSION, 'gemini_moderation_v2');
});

test('prompt encodes the agreed Artes nudity boundaries', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /implied nudity/i);
  assert.match(prompt, /bare buttocks/i);
  assert.match(prompt, /female nipples/i);
  assert.match(prompt, /visible genitalia/i);
  assert.match(prompt, /bare male chest/i);
  assert.match(prompt, /underwear, lingerie, swimwear, a thong, or a string/i);
});

test('prompt keeps erotic and BDSM content separate from explicit sex acts', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /adultEroticSuggestive/);
  assert.match(prompt, /kinkBdsm/);
  assert.match(prompt, /Do not use adultDecision="explicit" merely because an image is nude, erotic, fetish, or BDSM/i);
  assert.match(prompt, /penetration, oral sex, masturbation/i);
});

test('prompt does not ask AI to perform age verification', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Do not estimate an exact age/i);
  assert.match(prompt, /possible_minor_concern/);
});

test('prompt routes blocking concerns through forbiddenReasons instead of forbidden trigger severity', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /All trigger items must use severity "suggest"/i);
  assert.match(prompt, /serious safety issue.*forbiddenReasons/i);
});

test('prompt requires explicit confidence to agree with the adult decision', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /below 0\.5.*none.*borderline/i);
  assert.match(prompt, /at least 0\.5.*explicit/i);
});

test('parses JSON even when a model wraps it in extra text', () => {
  const parsed = parseGeminiModerationJson('result: {"triggers":[],"forbiddenReasons":[],"adultDecision":"none","sexualExplicitConfidence":0} done');
  assert.equal(parsed.adultDecision, 'none');
});

test('normalizes a valid adult result', () => {
  const normalized = normalizeGeminiModerationResult({
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 0.9, severity: 'suggest' }],
    forbiddenReasons: [],
    adultDecision: 'BORDERLINE',
    sexualExplicitConfidence: 0.2,
  });
  assert.equal(normalized.adultDecision, 'borderline');
  assert.equal(normalized.sexualExplicitConfidence, 0.2);
  assert.equal(normalized.triggers.length, 1);
});

test('rejects results without the required moderation fields', () => {
  assert.equal(normalizeGeminiModerationResult({ triggers: [], forbiddenReasons: [] }), null);
  assert.equal(normalizeGeminiModerationResult({ adultDecision: 'unknown', sexualExplicitConfidence: 0.2, triggers: [], forbiddenReasons: [] }), null);
});

test('rejects non-string adult decisions instead of coercing them', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: [],
    adultDecision: ['none'],
    sexualExplicitConfidence: 0,
  }), null);
  assert.equal(getGeminiModerationContractIssue({
    triggers: [],
    forbiddenReasons: [],
    adultDecision: ['none'],
    sexualExplicitConfidence: 0,
  }), 'invalid_adult_decision');
});

test('rejects non-array safety fields instead of silently discarding them', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: 'possible_minor_concern',
    adultDecision: 'borderline',
    sexualExplicitConfidence: 0.1,
  }), null);

  assert.equal(normalizeGeminiModerationResult({
    triggers: 'adultEroticSuggestive',
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});

test('rejects string confidence values and malformed trigger objects', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: '0.2',
  }), null);

  assert.equal(normalizeGeminiModerationResult({
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: '0.9', severity: 'suggest' }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});

test('rejects confidence values outside the zero-to-one contract', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: -1,
  }), null);

  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 1.01,
  }), null);

  assert.equal(normalizeGeminiModerationResult({
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 1.2, severity: 'suggest' }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});

test('rejects forbidden trigger severity until the policy consumer supports it safely', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [{ trigger: 'selfHarm', confidence: 0.95, severity: 'forbidden' }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});

test('requires graphic metadata on nonsexual sensitive Gemini triggers', () => {
  const missingGraphic = {
    triggers: [{ trigger: 'bloodInjury', confidence: 0.9, severity: 'suggest' }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  };
  assert.equal(normalizeGeminiModerationResult(missingGraphic), null);

  const withGraphic = normalizeGeminiModerationResult({
    ...missingGraphic,
    triggers: [{ trigger: 'bloodInjury', confidence: 0.9, severity: 'suggest', graphic: true }],
  });
  assert.equal(withGraphic.triggers[0].graphic, true);
});

test('rejects graphic=true outside supported graphic adult categories', () => {
  for (const trigger of ['substanceDistress', 'eatingDisorder', 'horrorScare']) {
    assert.equal(normalizeGeminiModerationResult({
      triggers: [{ trigger, confidence: 0.9, severity: 'suggest', graphic: true }],
      forbiddenReasons: [],
      adultDecision: 'none',
      sexualExplicitConfidence: 0,
    }), null);
  }
});

test('prompt distinguishes graphic from non-graphic sensitive content', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /graphic=true or graphic=false/i);
  assert.match(prompt, /deep open wounds/i);
  assert.match(prompt, /visible tissue/i);
});

test('rejects semantically contradictory adult decisions and explicit confidence', () => {
  const noneWithExplicitConfidence = {
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 1,
  };
  const borderlineWithExplicitConfidence = {
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'borderline',
    sexualExplicitConfidence: 0.8,
  };
  const explicitWithLowConfidence = {
    triggers: [],
    forbiddenReasons: [],
    adultDecision: 'explicit',
    sexualExplicitConfidence: 0.2,
  };

  for (const value of [noneWithExplicitConfidence, borderlineWithExplicitConfidence, explicitWithLowConfidence]) {
    assert.equal(normalizeGeminiModerationResult(value), null);
    assert.equal(getGeminiModerationContractIssue(value), 'semantic_contradiction');
  }
});

test('detects candidate-side Vertex safety blocks', () => {
  assert.equal(getGeminiSafetyBlockReason({
    candidate: { finishReason: 'SAFETY', safetyRatings: [] },
  }), 'candidate_safety');

  assert.equal(getGeminiSafetyBlockReason({
    candidate: { finishReason: 'STOP', safetyRatings: [{ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', blocked: true }] },
  }), 'candidate_safety_rating');
});

test('detects prompt-side Vertex safety blocks when no candidate is returned', () => {
  assert.equal(getGeminiSafetyBlockReason({
    promptFeedback: { blockReason: 'PROHIBITED_CONTENT', safetyRatings: [] },
  }), 'prompt_prohibited_content');

  assert.equal(getGeminiSafetyBlockReason({
    promptFeedback: { blockReason: 'OTHER', safetyRatings: [{ blocked: true }] },
  }), 'prompt_other');
});


test('prompt names the canonical nonsexual sensitive warning triggers', () => {
  const prompt = buildGeminiModerationPrompt();
  for (const trigger of ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare']) {
    assert.match(prompt, new RegExp(trigger));
  }
});


test('rejects retired non-warning trigger identifiers', () => {
  for (const trigger of ['needlesInjections', 'spidersInsects', 'drugUse', 'weapons']) {
    assert.equal(normalizeGeminiModerationResult({
      triggers: [{ trigger, confidence: 0.95, severity: 'suggest', graphic: false }],
      forbiddenReasons: [],
      adultDecision: 'none',
      sexualExplicitConfidence: 0,
    }), null);
  }
});

test('accepts severe substance distress but keeps ordinary substance use out of the warning vocabulary', () => {
  const normalized = normalizeGeminiModerationResult({
    triggers: [{ trigger: 'substanceDistress', confidence: 0.92, severity: 'suggest', graphic: false }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  });
  assert.equal(normalized?.triggers?.[0]?.trigger, 'substanceDistress');
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Ordinary smoking of tobacco or cannabis/i);
  assert.match(prompt, /substance use without visible serious distress are not sensitive/i);
  assert.match(prompt, /severely intoxicated, incapacitated/i);
} );

test('prompt keeps weapon presence general and makes horror warnings intensity based', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /weapon shown alone or in a posed non-threatening shoot is not sensitive/i);
  assert.match(prompt, /apparent threat, attack or active violence/i);
  assert.match(prompt, /horror theme, costume, mask, prop or spooky setting is not sensitive/i);
  assert.match(prompt, /Emit horrorScare only when the actual image is clearly visually disturbing/i);
});

test('rejects blank forbidden reason entries', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: ['   '],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});


test('rejects unknown trigger identifiers and free-form forbidden reasons', () => {
  assert.equal(normalizeGeminiModerationResult({
    triggers: [{ trigger: 'adultEroticSuggestiv', confidence: 0.9, severity: 'suggest' }],
    forbiddenReasons: [],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: ['nonsexual violence'],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  }), null);
});

test('requires canonical sexualExplicit reason for explicit decisions', () => {
  const valid = normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: ['sexualExplicit'],
    adultDecision: 'explicit',
    sexualExplicitConfidence: 0.6,
  });
  assert.equal(valid.adultDecision, 'explicit');
  assert.equal(normalizeGeminiModerationResult({
    triggers: [],
    forbiddenReasons: ['other_safety_review'],
    adultDecision: 'explicit',
    sexualExplicitConfidence: 0.6,
  }), null);
});


test('possible minor concerns require nudity or erotic adult context', () => {
  const noAdultContext = {
    triggers: [],
    forbiddenReasons: ['possible_minor_concern'],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  };
  assert.equal(getGeminiModerationContractIssue(noAdultContext), 'semantic_contradiction');
  assert.equal(normalizeGeminiModerationResult(noAdultContext), null);

  const nudityContext = normalizeGeminiModerationResult({
    ...noAdultContext,
    adultDecision: 'borderline',
  });
  assert.equal(nudityContext.adultDecision, 'borderline');

  const eroticContext = normalizeGeminiModerationResult({
    ...noAdultContext,
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 0.9, severity: 'suggest' }],
  });
  assert.equal(eroticContext.adultDecision, 'none');
});

test('prompt routes harmful self-harm and eating-disorder instructions to safety review', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /encourages, glorifies, or gives actionable instructions for self-harm/i);
  assert.match(prompt, /dangerous eating-disorder behavior/i);
  assert.match(prompt, /other_safety_review/i);
  assert.match(prompt, /Awareness, recovery, prevention/i);
});


test('treats every nonempty Vertex prompt block reason as a safety block', () => {
  assert.equal(getGeminiSafetyBlockReason({ promptFeedback: { blockReason: 'OTHER' } }), 'prompt_other');
  assert.equal(
    getGeminiSafetyBlockReason({ promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' } }),
    'prompt_block_reason_unspecified',
  );
});



test('explicit-act uncertainty has a structured review reason', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /sexual_explicit_uncertain/);
  const value = {
    triggers: [],
    forbiddenReasons: ['sexual_explicit_uncertain'],
    adultDecision: 'borderline',
    sexualExplicitConfidence: 0.49,
  };
  assert.equal(getGeminiModerationContractIssue(value), null);
  assert.equal(normalizeGeminiModerationResult(value)?.forbiddenReasons[0], 'sexual_explicit_uncertain');
});


test('sexual explicit uncertainty requires adult context', () => {
  const invalid = {
    triggers: [],
    forbiddenReasons: ['sexual_explicit_uncertain'],
    adultDecision: 'none',
    sexualExplicitConfidence: 0.2,
  };
  assert.equal(getGeminiModerationContractIssue(invalid), 'semantic_contradiction');
  assert.equal(normalizeGeminiModerationResult(invalid), null);

  const valid = {
    ...invalid,
    adultDecision: 'borderline',
    sexualExplicitConfidence: 0.49,
  };
  assert.equal(getGeminiModerationContractIssue(valid), null);
});


test('sexual explicit uncertainty rejects erotic-only none decisions', () => {
  const value = {
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 0.9, severity: 'suggest' }],
    forbiddenReasons: ['sexual_explicit_uncertain'],
    adultDecision: 'none',
    sexualExplicitConfidence: 0.2,
  };
  assert.equal(getGeminiModerationContractIssue(value), 'semantic_contradiction');
});


test('possible minor concerns require durable adult evidence', () => {
  const base = {
    forbiddenReasons: ['possible_minor_concern'],
    adultDecision: 'none',
    sexualExplicitConfidence: 0,
  };
  for (const confidence of [0.2, 0.45, 0.69]) {
    const value = {
      ...base,
      triggers: [{ trigger: 'adultEroticSuggestive', confidence, severity: 'suggest' }],
    };
    assert.equal(getGeminiModerationContractIssue(value), 'semantic_contradiction');
    assert.equal(normalizeGeminiModerationResult(value), null);
  }
  const durable = {
    ...base,
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 0.7, severity: 'suggest' }],
  };
  assert.equal(getGeminiModerationContractIssue(durable), null);
  assert.equal(normalizeGeminiModerationResult(durable)?.forbiddenReasons[0], 'possible_minor_concern');
});
