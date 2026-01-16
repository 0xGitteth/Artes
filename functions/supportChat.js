import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

export const ensureSupportThread = onRequest({ region: "europe-west1" }, (req, res) => {
  corsHandler(req, res, async () => {
    try {
      // ✅ Preflight moet 2xx zijn
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const decoded = await verifyIdToken(req);
      const uid = decoded.uid;

      const threadId = `support_${uid}`;
      const threadRef = db.collection("threads").doc(threadId);
      const indexRef = db.collection("users").doc(uid).collection("threadIndex").doc(threadId);

      const threadSnap = await threadRef.get();

      if (!threadSnap.exists) {
        await threadRef.set({
          type: "support",
          title: "Artes Moderatie",
          userUid: uid,
          participants: [uid],
          createdAt: FieldValue.serverTimestamp(),
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          userMaySend: true,
        });

        await threadRef.collection("messages").add({
          text:
            "Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen totdat wij reageren. We reageren binnen 3 werkdagen.",
          createdAt: FieldValue.serverTimestamp(),
          // Maak het voor elke mogelijke frontend check herkenbaar als system message
          type: "system",
          senderRole: "system",
          senderUid: "system",
          senderId: "system",
          senderLabel: "Artes Moderatie",
        });
      }

      const indexSnap = await indexRef.get();
      if (!indexSnap.exists) {
        await indexRef.set({
          threadId,
          type: "support",
          pinned: true,
          displayTitle: "Artes Moderatie",
          lastMessageAt: FieldValue.serverTimestamp(),
        });
      } else {
        await indexRef.set({ pinned: true, displayTitle: "Artes Moderatie" }, { merge: true });
      }

      return res.status(200).json({ ok: true, threadId });
    } catch (e) {
      logger.error("ensureSupportThread failed", e);
      return res.status(401).json({ error: e?.message || "Unauthorized" });
    }
  });
});

// ✅ Alias: jouw frontend roept deze naam aan
export const ensureModerationThread = ensureSupportThread;
