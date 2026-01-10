import crypto from 'crypto';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { VertexAI } from '@google-cloud/vertexai';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const suggestThreshold = 0.45;
const forbiddenThreshold = 0.7;
const mediumLogThreshold = 0.55;

const likelihoodScores = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 0.1,
  UNLIKELY: 0.25,
  POSSIBLE: 0.5,
  LIKELY: 0.7,
  VERY_LIKELY: 0.9,
};

const dataUrlPattern = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

const needlesKeywords = ['needle', 'syringe', 'injection', 'injections', 'hypodermic', 'vaccination'];
const spidersKeywords = ['spider', 'spiders', 'insect', 'insects', 'bug', 'bugs', 'beetle', 'mosquito', 'cockroach', 'ant', 'fly'];
const dhashPrefixLength = 4;
const dhashThreshold = Number.parseInt(process.env.DHASH_HAMMING_THRESHOLD || '8', 10);
const falseAppealThreshold = Number.parseInt(process.env.FALSE_APPEAL_THRESHOLD || '2', 10);
const cooldownDays = Number.parseInt(process.env.REVIEW_COOLDOWN_DAYS || '7', 10);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

const normalizeMakerTags = (makerTags) => {
  const raw = Array.isArray(makerTags)
    ? makerTags
    : typeof makerTags === 'string'
      ? makerTags.split(',')
      : [];
  const normalized = raw
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
  return [...new Set(normalized)];
};

const scoreFromLikelihood = (likelihood) => likelihoodScores[likelihood] ?? 0;

const parseImageDataUrl = (image) => {
  if (typeof image !== 'string') {
    return { error: 'Image moet een base64 data-URL string zijn.' };
  }
  const match = image.match(dataUrlPattern);
  if (!match) {
    return { error: 'Image moet een geldige base64 data-URL zijn (png/jpg/webp).' };
  }
  const mimeType = `image/${match[1]}`;
  const buffer = Buffer.from(match[2], 'base64');
  return { buffer, mimeType };
};

const ensureJsonBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }
  return null;
};

const hexBitCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

const computeDhash = async (buffer) => {
  const resized = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  const bits = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = resized[y * 9 + x];
      const right = resized[y * 9 + x + 1];
      bits.push(left > right ? '1' : '0');
    }
  }
  const hex = [];
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4).join('');
    hex.push(Number.parseInt(chunk, 2).toString(16));
  }
  return hex.join('');
};

const hammingDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const xor = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    distance += hexBitCounts[xor] || 0;
  }
  return distance;
};

const buildFingerprint = async (buffer) => {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const dhash = await computeDhash(buffer);
  return {
    sha256,
    dhash,
    dhashPrefix: dhash.slice(0, dhashPrefixLength),
  };
};

const resolveTimestamp = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getUserModeration = async (userId) => {
  if (!userId) return null;
  const ref = db.collection('userModeration').doc(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    const initial = {
      openReviewCount: 0,
      cooldownUntil: null,
      falseAppealCount: 0,
      reviewRightsLevel: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(initial);
    return { ref, data: initial };
  }
  return { ref, data: snapshot.data() };
};

const findOpenReviewCase = async (userId) => {
  if (!userId) return null;
  const snapshot = await db
    .collection('reviewCases')
    .where('userId', '==', userId)
    .where('status', '==', 'inReview')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
};

const findExactUpload = async (sha256) => {
  const snapshot = await db.collection('uploads').where('fingerprints.sha256', '==', sha256).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
};

const findNearDuplicateUpload = async ({ dhash, dhashPrefix }) => {
  if (!dhash) return null;
  const snapshot = await db
    .collection('uploads')
    .where('fingerprints.dhashPrefix', '==', dhashPrefix)
    .limit(25)
    .get();
  if (snapshot.empty) return null;
  let best = null;
  snapshot.docs.forEach((doc) => {
    const candidate = doc.data();
    const distance = hammingDistance(dhash, candidate?.fingerprints?.dhash);
    if (distance <= dhashThreshold && (!best || distance < best.distance)) {
      best = { id: doc.id, data: candidate, distance };
    }
  });
  return best;
};

const extractLabelScore = (labels, keywords) => {
  if (!labels?.length) return 0;
  return labels.reduce((maxScore, label) => {
    const description = label.description?.toLowerCase() || '';
    if (keywords.some((keyword) => description.includes(keyword))) {
      return Math.max(maxScore, Number(label.score) || 0);
    }
    return maxScore;
  }, 0);
};

const buildTriggerRecord = (trigger, score, source) => ({ trigger, score, source });

const parseGeminiJson = (text) => {
  if (!text) return null;
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    return null;
  }
};

const runGeminiClassifier = async ({ buffer, mimeType }) => {
  if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
    return null;
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project) {
    logger.warn('Gemini classifier skipped: GOOGLE_CLOUD_PROJECT ontbreekt.');
    return null;
  }
  const vertex = new VertexAI({ project, location });
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-002';
  const model = vertex.getGenerativeModel({ model: modelName });
  const prompt = [
    'You are a moderation classifier. Return ONLY valid JSON.',
    'Schema: {"triggers": [{"trigger": string, "confidence": number, "severity": "suggest"|"forbidden"}], "forbiddenReasons": [string]}',
    'Only include triggers that are NOT nudityErotic, explicit18, needlesInjections, spidersInsects.',
    'If nothing is detected, return {"triggers": [], "forbiddenReasons": []}.',
  ].join('\n');

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { data: buffer.toString('base64'), mimeType } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  });

  const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseGeminiJson(text);
};

export const moderateImage = onRequest({ cors: true }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Gebruik POST.' });
    return;
  }

  const body = ensureJsonBody(req);
  if (!body) {
    res.status(400).json({ error: 'Ongeldige JSON body.' });
    return;
  }

  const { image, makerTags, userId } = body;
  const parsed = parseImageDataUrl(image);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  let fingerprints;
  try {
    fingerprints = await buildFingerprint(parsed.buffer);
  } catch (error) {
    logger.error('Fingerprint generatie mislukt.', error);
    res.status(500).json({ error: 'Kon fingerprints niet genereren.' });
    return;
  }

  let matchedUpload = null;
  try {
    matchedUpload = await findExactUpload(fingerprints.sha256);
    if (!matchedUpload) {
      matchedUpload = await findNearDuplicateUpload(fingerprints);
    }
  } catch (error) {
    logger.error('Upload lookup mislukt.', error);
  }

  let cachedResult = null;
  if (matchedUpload?.data) {
    cachedResult = {
      outcome: matchedUpload.data.outcome,
      appliedTriggers: matchedUpload.data.appliedTriggers || [],
      suggestedTriggers: matchedUpload.data.suggestedTriggers || [],
      forbiddenReasons: matchedUpload.data.forbiddenReasons || [],
      reviewCaseId: matchedUpload.data.reviewCaseId || null,
    };
  }

  const normalizedMakerTags = normalizeMakerTags(makerTags);
  const appliedTriggers = normalizedMakerTags.map((tag) => buildTriggerRecord(tag, 1, 'makerTag'));
  const suggestedTriggers = [];
  const forbiddenReasons = [];

  const imageAnnotator = new ImageAnnotatorClient();
  let labels = [];
  let safeSearch = null;

  if (cachedResult) {
    labels = [];
  }

  if (!cachedResult) {
    try {
      const [safeSearchResult] = await imageAnnotator.safeSearchDetection({
        image: { content: parsed.buffer },
      });
      safeSearch = safeSearchResult.safeSearchAnnotation || null;
    } catch (error) {
      logger.error('SafeSearch detectie mislukt.', error);
    }
  }

  if (!cachedResult) {
    try {
      const [labelResult] = await imageAnnotator.labelDetection({
        image: { content: parsed.buffer },
        maxResults: 15,
      });
      labels = labelResult.labelAnnotations || [];
    } catch (error) {
      logger.error('Label detectie mislukt.', error);
    }
  }

  if (!cachedResult && safeSearch) {
    const nudityScore = scoreFromLikelihood(safeSearch.racy);
    const explicitScore = scoreFromLikelihood(safeSearch.adult);

    if (nudityScore >= forbiddenThreshold) {
      appliedTriggers.push(buildTriggerRecord('nudityErotic', nudityScore, 'safeSearch'));
      forbiddenReasons.push({ trigger: 'nudityErotic', reason: 'SafeSearch racy', score: nudityScore });
    } else if (nudityScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord('nudityErotic', nudityScore, 'safeSearch'));
    }

    if (explicitScore >= forbiddenThreshold) {
      appliedTriggers.push(buildTriggerRecord('explicit18', explicitScore, 'safeSearch'));
      forbiddenReasons.push({ trigger: 'explicit18', reason: 'SafeSearch adult', score: explicitScore });
    } else if (explicitScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord('explicit18', explicitScore, 'safeSearch'));
    }

    if (nudityScore >= mediumLogThreshold || explicitScore >= mediumLogThreshold) {
      logger.info('Medium log threshold bereikt.', { nudityScore, explicitScore });
    }
  }

  const needlesScore = cachedResult ? 0 : extractLabelScore(labels, needlesKeywords);
  const spidersScore = cachedResult ? 0 : extractLabelScore(labels, spidersKeywords);

  if (!cachedResult) {
    if (needlesScore >= forbiddenThreshold) {
      appliedTriggers.push(buildTriggerRecord('needlesInjections', needlesScore, 'labelDetection'));
      forbiddenReasons.push({ trigger: 'needlesInjections', reason: 'Vision labels', score: needlesScore });
    } else if (needlesScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord('needlesInjections', needlesScore, 'labelDetection'));
    }
  }

  if (!cachedResult) {
    if (spidersScore >= forbiddenThreshold) {
      appliedTriggers.push(buildTriggerRecord('spidersInsects', spidersScore, 'labelDetection'));
      forbiddenReasons.push({ trigger: 'spidersInsects', reason: 'Vision labels', score: spidersScore });
    } else if (spidersScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord('spidersInsects', spidersScore, 'labelDetection'));
    }
  }

  if (!cachedResult && (needlesScore >= mediumLogThreshold || spidersScore >= mediumLogThreshold)) {
    logger.info('Medium log threshold labels bereikt.', { needlesScore, spidersScore });
  }

  if (!cachedResult) {
    try {
      const geminiResult = await runGeminiClassifier(parsed);
      if (geminiResult?.triggers?.length) {
        geminiResult.triggers.forEach((item) => {
          const trigger = String(item.trigger || '').trim();
          const confidence = Number(item.confidence) || 0;
          if (!trigger) return;
          if (item.severity === 'forbidden' && confidence >= suggestThreshold) {
            appliedTriggers.push(buildTriggerRecord(trigger, confidence, 'gemini'));
            forbiddenReasons.push({ trigger, reason: 'Gemini classifier', score: confidence });
          } else if (confidence >= suggestThreshold) {
            suggestedTriggers.push(buildTriggerRecord(trigger, confidence, 'gemini'));
          }
        });
      }
      if (geminiResult?.forbiddenReasons?.length) {
        geminiResult.forbiddenReasons.forEach((reason) => {
          if (typeof reason === 'string' && reason.trim()) {
            forbiddenReasons.push({ trigger: 'gemini', reason: reason.trim(), score: 1 });
          }
        });
      }
    } catch (error) {
      logger.error('Gemini classifier fout.', error);
    }
  }

  const outcome = cachedResult
    ? cachedResult.outcome
    : forbiddenReasons.length
      ? 'forbidden'
      : suggestedTriggers.length
        ? 'suggested'
        : 'allowed';

  const cachedAppliedTriggers = cachedResult ? cachedResult.appliedTriggers : [];
  const finalAppliedTriggers = cachedResult
    ? [...cachedAppliedTriggers, ...appliedTriggers.filter((item) =>
        !cachedAppliedTriggers.some((cached) => cached.trigger === item.trigger && cached.source === item.source)
      )]
    : appliedTriggers;
  const finalSuggestedTriggers = cachedResult ? cachedResult.suggestedTriggers : suggestedTriggers;
  const finalForbiddenReasons = cachedResult ? cachedResult.forbiddenReasons : forbiddenReasons;

  let reviewCaseId = cachedResult?.reviewCaseId || null;
  let canRequestReview = outcome === 'forbidden';
  let openReviewCase = null;
  let userModeration = null;
  let inCooldown = false;
  let reviewCreated = false;

  if (userId && outcome === 'forbidden') {
    try {
      userModeration = await getUserModeration(userId);
      const cooldownUntil = resolveTimestamp(userModeration?.data?.cooldownUntil);
      if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
        inCooldown = true;
      }
      openReviewCase = await findOpenReviewCase(userId);
      if (openReviewCase) {
        reviewCaseId = openReviewCase.id;
      }
      if (!reviewCaseId && !openReviewCase && !inCooldown) {
        const rightsLevel = Number(userModeration?.data?.reviewRightsLevel ?? 1);
        const openCount = Number(userModeration?.data?.openReviewCount ?? 0);
        if (rightsLevel > 0 && openCount < 1) {
          const reviewRef = await db.collection('reviewCases').add({
            userId,
            status: 'inReview',
            decision: null,
            fingerprints: [fingerprints],
            linkedUploadIds: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          reviewCaseId = reviewRef.id;
          reviewCreated = true;
          await userModeration.ref.set(
            {
              openReviewCount: 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    } catch (error) {
      logger.error('User moderation check mislukt.', error);
    }
  }

  canRequestReview = outcome === 'forbidden' && !inCooldown && !openReviewCase && !reviewCreated;

  if (reviewCaseId && userId && !openReviewCase) {
    try {
      const reviewSnapshot = await db.collection('reviewCases').doc(reviewCaseId).get();
      if (reviewSnapshot.exists) {
        const reviewData = reviewSnapshot.data();
        if (reviewData?.status === 'resolved' && reviewData?.decision === 'rejected' && userModeration) {
          const newFalseAppealCount = Number(userModeration.data?.falseAppealCount ?? 0) + 1;
          const shouldCooldown = newFalseAppealCount >= falseAppealThreshold;
          await userModeration.ref.set(
            {
              falseAppealCount: newFalseAppealCount,
              cooldownUntil: shouldCooldown
                ? new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000)
                : userModeration.data?.cooldownUntil || null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    } catch (error) {
      logger.error('Review case cooldown update mislukt.', error);
    }
  }

  const response = {
    outcome,
    appliedTriggers: finalAppliedTriggers,
    suggestedTriggers: finalSuggestedTriggers,
    forbiddenReasons: finalForbiddenReasons,
    showSuggestionUI: finalSuggestedTriggers.length > 0,
    canRequestReview,
    reviewCaseId,
    fingerprints,
    legacy: {
      labels: labels.map((label) => label.description).filter(Boolean),
      isSensitive: outcome !== 'allowed',
    },
  };

  let uploadId = null;
  try {
    const uploadPayload = {
      userId: userId || null,
      outcome,
      appliedTriggers: finalAppliedTriggers,
      suggestedTriggers: finalSuggestedTriggers,
      forbiddenReasons: finalForbiddenReasons,
      reviewCaseId: reviewCaseId || null,
      fingerprints,
      matchedUploadId: matchedUpload?.id || null,
      createdAt: FieldValue.serverTimestamp(),
    };
    const uploadRef = await db.collection('uploads').add(uploadPayload);
    uploadId = uploadRef.id;
  } catch (error) {
    logger.error('Upload opslaan mislukt.', error);
  }

  if (reviewCaseId && uploadId) {
    try {
      await db.collection('reviewCases').doc(reviewCaseId).set(
        {
          linkedUploadIds: FieldValue.arrayUnion(uploadId),
          fingerprints: FieldValue.arrayUnion(fingerprints),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logger.error('Review case koppelen mislukt.', error);
    }
  }

  res.status(200).json(response);
});

export const config = {
  runtime: 'nodejs18',
};
