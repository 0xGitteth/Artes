import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";
import crypto from "node:crypto";

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { isCodexDevForProductionDeny } from "./codexDevIdentity.js";
import {
  acquireCodexDevLifecycleFence,
  isKnownCodexDevActorUid,
  readAndValidateCodexDevLifecycleFence,
  releaseCodexDevLifecycleFence,
} from "./codexDevActorRegistry.js";

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
const corsHandler = cors({ origin: true });

async function verifyIdToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new Error("Missing Authorization: Bearer <token>");
  return auth.verifyIdToken(match[1]);
}

export const deleteOnboardingAccount = onRequest({ region: "europe-west4" }, (req, res) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const decoded = await verifyIdToken(req);
      if (isCodexDevForProductionDeny(decoded)) {
        return res.status(403).json({ error: "Codex Dev identity cannot be deleted" });
      }
      const uid = decoded.uid;
      if (!uid) {
        return res.status(400).json({ error: "Missing user id" });
      }
      if (await isKnownCodexDevActorUid({ db, uid })) {
        return res.status(403).json({ error: "Codex Dev identity cannot be deleted" });
      }

      const lifecycleToken = crypto.randomUUID();
      await acquireCodexDevLifecycleFence({ db, uid, token: lifecycleToken });
      try {
        const userRef = db.collection("users").doc(uid);
        const publicUserRef = db.collection("publicUsers").doc(uid);
        await db.runTransaction(async (transaction) => {
          await readAndValidateCodexDevLifecycleFence({
            db, uid, token: lifecycleToken, transaction,
          });
          const userSnapshot = await transaction.get(userRef);
          if (!userSnapshot.exists) {
            const error = new Error("User profile not found");
            error.status = 404;
            throw error;
          }
          if (userSnapshot.get("onboardingComplete") === true) {
            const error = new Error("Onboarding already completed");
            error.status = 403;
            throw error;
          }
          transaction.delete(userRef);
          transaction.delete(publicUserRef);
        });

        await auth.deleteUser(uid);
      } finally {
        try {
          await releaseCodexDevLifecycleFence({ db, uid, token: lifecycleToken });
        } catch (releaseError) {
          logger.error("deleteOnboardingAccount lifecycle fence release failed", releaseError);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      logger.error("deleteOnboardingAccount failed", e);
      const message = e?.message || "Unauthorized";
      return res.status(e?.status || 401).json({ error: message });
    }
  });
});
