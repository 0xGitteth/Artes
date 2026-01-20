import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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

export const deleteOnboardingAccount = onRequest({ region: "europe-west1" }, (req, res) => {
  corsHandler(req, res, async () => {
    try {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const decoded = await verifyIdToken(req);
      const uid = decoded.uid;
      if (!uid) {
        return res.status(400).json({ error: "Missing user id" });
      }

      const userRef = db.collection("users").doc(uid);
      const publicUserRef = db.collection("publicUsers").doc(uid);

      await Promise.all([
        userRef.delete().catch(() => null),
        publicUserRef.delete().catch(() => null),
      ]);

      await auth.deleteUser(uid);

      return res.status(200).json({ ok: true });
    } catch (e) {
      logger.error("deleteOnboardingAccount failed", e);
      const message = e?.message || "Unauthorized";
      return res.status(401).json({ error: message });
    }
  });
});
