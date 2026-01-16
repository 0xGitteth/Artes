import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import cors from "cors";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function verifyIdToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new Error("Missing Authorization: Bearer <token>");
  return admin.auth().verifyIdToken(match[1]);
}

const corsHandler = cors({ origin: true });

export const ensureSupportThread = onRequest({ cors: true, region: "europe-west1" }, (req, res) => {
  corsHandler(req, res, async () => {
    try {
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
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          userMaySend: true,
        });

        await threadRef.collection("messages").add({
          text:
            "Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen totdat wij reageren. We reageren binnen 3 werkdagen.",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          senderRole: "system",
          senderLabel: "Artes Moderatie",
          senderUid: "system",
        });
      }

      const indexSnap = await indexRef.get();
      if (!indexSnap.exists) {
        await indexRef.set({
          threadId,
          type: "support",
          pinned: true,
          displayTitle: "Artes Moderatie",
          lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
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
