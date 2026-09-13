export const routeGeminiForbiddenReasons = ({
  forbiddenReasons = [],
  adultDecision = null,
  sexualExplicitConfidence = 0,
  forbiddenThreshold = 0.7,
  sexualExplicitTrigger = 'sexualExplicit',
} = {}) => {
  const normalizedDecision = typeof adultDecision === 'string' ? adultDecision.trim() : null;
  const confidence = Number.isFinite(Number(sexualExplicitConfidence))
    ? Number(sexualExplicitConfidence)
    : 0;
  const threshold = Number.isFinite(Number(forbiddenThreshold))
    ? Number(forbiddenThreshold)
    : 0.7;
  const records = [];
  let explicitDecisionAddedForbiddenReason = false;

  (Array.isArray(forbiddenReasons) ? forbiddenReasons : []).forEach((reason) => {
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!normalizedReason) return;

    if (normalizedReason === sexualExplicitTrigger) {
      if (normalizedDecision === 'explicit' && confidence >= threshold) {
        records.push({
          trigger: sexualExplicitTrigger,
          reason: 'Gemini explicit adult decision',
          score: confidence,
        });
        explicitDecisionAddedForbiddenReason = true;
        return;
      }

      records.push({
        trigger: 'gemini',
        reason: 'sexual_explicit_uncertain',
        score: confidence,
      });
      return;
    }

    records.push({
      trigger: 'gemini',
      reason: normalizedReason,
      score: 1,
    });
  });

  return { records, explicitDecisionAddedForbiddenReason };
};
