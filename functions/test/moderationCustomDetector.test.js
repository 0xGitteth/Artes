import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCustomDetectorAutomation, buildCustomDetectorPolicyEvidence, enforceCustomDetectorReview, runCustomDetectorInference, CUSTOM_DETECTOR_POLICY_VERSION } from '../moderationCustomDetector.js';
import { createServer } from 'node:http';
import { composeModerationPolicyResult } from '../moderationPolicy.js';
const detector = (change = {}) => ({ modelVersion: 'm1', datasetVersion: 'd1', labelVersion: 'artes_detector_v1', detectorLabel: { nudity: 'none', sexualContext: 'none', graphicInjury: 'none', sensitiveSignals: [], possibleMinorConcern: false, confidence: 0.99, uncertaintyFlags: [], ...change } });
const gate = { validated: true, minConfidence: .97, heldOutGroups: 400, heldOutExamples: 400, criticalMisses: 0, precisionLowerBound: .9904 };
const approval = { approved: true, policyVersion: CUSTOM_DETECTOR_POLICY_VERSION, modelVersion: 'm1', datasetVersion: 'd1', labelVersion: 'artes_detector_v1', classes: Object.fromEntries(['general','adult_nudity','erotic','explicit'].map(c=>[c,gate])) };
const assess = result => assessCustomDetectorAutomation({ detectorResult: result, approval });
for (const [name,label,classification] of [
  ['general', {}, 'allowed_general'],
  ['nonsexual genitalia', { nudity: 'genitalia' }, 'allowed_adult_art_nude'],
  ['covered erotica', { sexualContext: 'suggestive', nudity: 'underwear_swimwear' }, 'allowed_adult_erotic_suggestive'],
  ['BDSM', { sexualContext: 'bdsm_kink' }, 'allowed_adult_erotic_suggestive'],
  ['masturbation or other explicit act', { sexualContext: 'explicit_act' }, 'disallowed_sexual_explicit'],
]) test(`${name}: approved detector follows deterministic policy`, () => {
  const assessment=assess(detector(label));assert.equal(assessment.automated,true);
  const evidence=buildCustomDetectorPolicyEvidence(assessment);
  const result=composeModerationPolicyResult({ appliedTriggers:evidence.appliedTriggers, forbiddenReasons:evidence.forbiddenReasons, customDetectorEvidence:evidence });
  assert.equal(result.classification,classification);assert.equal(result.shouldReview,false);
  assert.equal(result.outcome,label.sexualContext==='explicit_act'?'forbidden':'allowed');
});
test('confidence alone cannot authorize publication',()=>{
  assert.equal(assessCustomDetectorAutomation({detectorResult:detector()}).reason,'model_not_approved');
  assert.equal(assessCustomDetectorAutomation({detectorResult:detector(),approval:{...approval,modelVersion:'wrong'}}).reason,'approved_model_version_mismatch');
  assert.equal(assess(detector({confidence:.96})).reason,'below_calibrated_threshold');
});
test('minor, uncertainty, sensitive context, uncovered labels and missing classifier fail closed',()=>{
  for(const label of [{possibleMinorConcern:true},{uncertaintyFlags:['incomplete_head_coverage:nudity']},{sensitiveSignals:['selfHarm']},{graphicInjury:'mild'},{sexualContext:'explicit_act',graphicInjury:'graphic'},{sexualContext:'explicit_act',sensitiveSignals:['violence']}])assert.equal(assess(detector(label)).automated,false);
  assert.equal(assess(null).automated,false);
  assert.equal(assessCustomDetectorAutomation({detectorResult:detector(),approval:{...approval,classes:{}}}).reason,'class_not_calibrated');
});
test('failed release precision gate cannot automate',()=>{
  assert.equal(assessCustomDetectorAutomation({detectorResult:detector(),approval:{...approval,classes:{general:{...gate,precisionLowerBound:.95}}}}).reason,'benchmark_gate_not_met');
});
test('missing, nonfinite and inconsistent benchmark counts cannot authorize automation', () => {
  for (const changes of [{ heldOutGroups: undefined }, { heldOutGroups: NaN }, { heldOutExamples: '400' }, { heldOutGroups: 500 }, { precisionLowerBound: 1.01 }, { criticalMisses: 1 }]) {
    assert.equal(assessCustomDetectorAutomation({ detectorResult: detector(), approval: { ...approval, classes: { general: { ...gate, ...changes } } } }).automated, false);
  }
});
test('SafeSearch alone cannot convert accepted nonsexual nudity to explicit',()=>{
  const evidence=buildCustomDetectorPolicyEvidence(assess(detector({nudity:'genitalia'})));
  const r=composeModerationPolicyResult({appliedTriggers:evidence.appliedTriggers,customDetectorEvidence:evidence,safeSearchAdultScore:1,safeSearchNudityScore:1});
  assert.equal(r.classification,'allowed_adult_art_nude');assert.equal(r.outcome,'allowed');
});
test('service failure produces a blocked review; previous moderator authority is preserved',()=>{
  const p=composeModerationPolicyResult({});const r=enforceCustomDetectorReview({policyResult:p,assessment:{reason:'custom_detector_unavailable'}});
  assert.equal(r.outcome,'review');assert.equal(r.publishBlocked,true);
  assert.equal(enforceCustomDetectorReview({policyResult:p,previousAuthority:true}),p);
  const rejected={...p,outcome:'forbidden'};assert.equal(enforceCustomDetectorReview({policyResult:rejected}),rejected);
});
test('authenticated HTTP inference reaches deterministic policy without accepting provider policy claims', async (t) => {
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/infer');
    assert.equal(request.headers.authorization, 'Bearer fixture-token');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body.requestedOutputs, ['embedding', 'detector']);
    assert.equal(body.image.base64, Buffer.from('fixture').toString('base64'));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ embedding: { provider: 'artes_custom_vision', model: 'dinov2_vitb14', vector: [1, ...Array(767).fill(0)] }, detectorResult: detector({ nudity: 'genitalia' }) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await runCustomDetectorInference({ image: { buffer: Buffer.from('fixture'), mimeType: 'image/jpeg' }, endpoint: `http://127.0.0.1:${server.address().port}`, bearerToken: 'fixture-token', releaseJson: JSON.stringify(approval) });
  assert.equal(result.diagnostics.automated, true);
  const policy = composeModerationPolicyResult({ appliedTriggers: result.evidence.appliedTriggers, forbiddenReasons: result.evidence.forbiddenReasons, customDetectorEvidence: result.evidence });
  assert.equal(policy.classification, 'allowed_adult_art_nude');
  assert.equal(policy.shouldReview, false);
});
test('invalid release JSON and failed requests become review evidence', async () => {
  for (const releaseJson of ['invalid-json', JSON.stringify(approval)]) {
    const result = await runCustomDetectorInference({ image: { buffer: Buffer.from('fixture'), mimeType: 'image/jpeg' }, endpoint: 'http://127.0.0.1:1', releaseJson, fetchImpl: async () => { throw new Error('unavailable'); } });
    assert.equal(result.assessment.automated, false);
    assert.equal(result.evidence, null);
    assert.equal(enforceCustomDetectorReview({ policyResult: composeModerationPolicyResult({}), assessment: result.assessment }).publishBlocked, true);
  }
});
