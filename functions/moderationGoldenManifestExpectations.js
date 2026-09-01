const DURABLE_ADULT_CONTEXT_CONFIDENCE = 0.7;
const ADULT_CONTEXT_TRIGGERS = new Set(['adultEroticSuggestive', 'kinkBdsm']);

const normalizedReasons = (parsed) => (
  Array.isArray(parsed?.forbiddenReasons)
    ? parsed.forbiddenReasons.map((reason) => String(reason || '').trim()).filter(Boolean)
    : []
);

const normalizedTriggers = (parsed) => (
  Array.isArray(parsed?.triggers)
    ? parsed.triggers.filter((item) => item && typeof item === 'object')
    : []
);

const triggerMinimum = (trigger) => (
  ADULT_CONTEXT_TRIGGERS.has(trigger) ? DURABLE_ADULT_CONTEXT_CONFIDENCE : 0
);

const findTrigger = (parsed, trigger, minConfidence = triggerMinimum(trigger)) => (
  normalizedTriggers(parsed).find((item) => (
    item?.trigger === trigger
    && typeof item?.confidence === 'number'
    && Number.isFinite(item.confidence)
    && item.confidence >= minConfidence
  )) || null
);

const hasTrigger = (parsed, trigger, minConfidence = triggerMinimum(trigger)) => (
  Boolean(findTrigger(parsed, trigger, minConfidence))
);

const sameStringSet = (left, right) => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
};

const fail = (id, message) => `${id}: ${message}`;

export const getManifestGoldenExpectationFailure = ({ item, result }) => {
  const id = item?.id || 'UNKNOWN_GOLDEN';
  const expected = item?.expected || {};
  const parsed = result?.parsed || null;
  const safetyBlocked = result?.diagnostics?.safetyBlocked === true;

  if (safetyBlocked) {
    return expected.allowProviderSafetyBlock === true
      ? null
      : fail(id, `provider safety block was not an allowed outcome (${result?.diagnostics?.safetyBlockReason || 'unknown'})`);
  }

  if (!parsed) {
    return fail(id, `expected a validated classifier result, got ${result?.diagnostics?.fallbackReason || 'no parsed result'}`);
  }

  if (expected.adultDecision && parsed.adultDecision !== expected.adultDecision) {
    return fail(id, `expected adultDecision=${expected.adultDecision}, got ${parsed.adultDecision}`);
  }

  const reasons = normalizedReasons(parsed);
  if (Array.isArray(expected.forbiddenReasons) && !sameStringSet(reasons, expected.forbiddenReasons)) {
    return fail(id, `expected exact forbiddenReasons=${JSON.stringify(expected.forbiddenReasons)}, got ${JSON.stringify(reasons)}`);
  }

  for (const reason of expected.requiredForbiddenReasons || []) {
    if (!reasons.includes(reason)) return fail(id, `missing required forbidden reason ${reason}`);
  }

  for (const reason of expected.forbiddenReasonsAbsent || []) {
    if (reasons.includes(reason)) return fail(id, `forbidden reason ${reason} must be absent`);
  }

  for (const trigger of expected.requiredTriggers || []) {
    if (!hasTrigger(parsed, trigger)) {
      return fail(id, `missing required trigger ${trigger} at minimum confidence ${triggerMinimum(trigger)}`);
    }
  }

  if (Array.isArray(expected.requiredTriggersAny) && expected.requiredTriggersAny.length > 0) {
    const hasAny = expected.requiredTriggersAny.some((trigger) => hasTrigger(parsed, trigger));
    if (!hasAny) {
      return fail(id, `expected at least one trigger from ${JSON.stringify(expected.requiredTriggersAny)}`);
    }
  }

  for (const trigger of expected.forbiddenTriggers || []) {
    if (hasTrigger(parsed, trigger, 0)) return fail(id, `trigger ${trigger} must be absent`);
  }

  if (Array.isArray(expected.adultTriggers) && expected.adultTriggers.length === 0) {
    const durableAdultTrigger = normalizedTriggers(parsed).find((item) => (
      ADULT_CONTEXT_TRIGGERS.has(item?.trigger)
      && typeof item?.confidence === 'number'
      && item.confidence >= DURABLE_ADULT_CONTEXT_CONFIDENCE
    ));
    if (durableAdultTrigger) {
      return fail(id, `unexpected durable adult trigger ${durableAdultTrigger.trigger} (${durableAdultTrigger.confidence})`);
    }
  }

  if (typeof expected.sexualExplicitConfidenceMin === 'number') {
    if (!(typeof parsed.sexualExplicitConfidence === 'number'
      && parsed.sexualExplicitConfidence >= expected.sexualExplicitConfidenceMin)) {
      return fail(id, `sexualExplicitConfidence must be >= ${expected.sexualExplicitConfidenceMin}`);
    }
  }

  if (typeof expected.sexualExplicitConfidenceMaxExclusive === 'number') {
    if (!(typeof parsed.sexualExplicitConfidence === 'number'
      && parsed.sexualExplicitConfidence < expected.sexualExplicitConfidenceMaxExclusive)) {
      return fail(id, `sexualExplicitConfidence must be < ${expected.sexualExplicitConfidenceMaxExclusive}`);
    }
  }

  if (typeof expected.requiredGraphic === 'boolean') {
    const requiredNames = [
      ...(expected.requiredTriggers || []),
      ...(expected.requiredTriggersAny || []),
    ];
    const candidates = normalizedTriggers(parsed).filter((item) => (
      requiredNames.length === 0 || requiredNames.includes(item?.trigger)
    ));
    if (expected.requiredGraphic === true) {
      if (!candidates.some((item) => item?.graphic === true)) {
        return fail(id, 'expected at least one relevant graphic=true trigger');
      }
    } else {
      const matchedRequired = candidates.filter((item) => (
        hasTrigger(parsed, item?.trigger)
      ));
      if (matchedRequired.length === 0) {
        return fail(id, 'required sensitive trigger was not available for graphic=false validation');
      }
      if (matchedRequired.some((item) => item?.graphic !== false)) {
        return fail(id, 'expected relevant sensitive trigger(s) to use graphic=false');
      }
    }
  }

  return null;
};

export const validateGoldenExpansionManifest = (manifest) => {
  const failures = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest must be an object'];
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) return ['manifest.cases must be a non-empty array'];

  const seen = new Set();
  manifest.cases.forEach((item, index) => {
    const prefix = `cases[${index}]`;
    if (!item?.id || typeof item.id !== 'string') failures.push(`${prefix}.id is required`);
    else if (seen.has(item.id)) failures.push(`${prefix}.id duplicates ${item.id}`);
    else seen.add(item.id);

    if (!['existing', 'ready', 'needs_image'].includes(item?.status)) {
      failures.push(`${prefix}.status must be existing, ready, or needs_image`);
    }
    if (!['release_gate', 'confidence_expansion'].includes(item?.tier)) {
      failures.push(`${prefix}.tier must be release_gate or confidence_expansion`);
    }
    if ((item?.status === 'existing' || item?.status === 'ready') && !item?.file) {
      failures.push(`${prefix}.file is required when status=${item?.status}`);
    }
    if (!item?.expected || typeof item.expected !== 'object') failures.push(`${prefix}.expected is required`);
  });

  return failures;
};
