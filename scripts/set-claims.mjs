import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

initializeApp({
  credential: cert(JSON.parse(fs.readFileSync("./serviceAccount.json", "utf8"))),
});

const auth = getAuth();
const db = getFirestore();

const snap = await db.collection("users").get();

for (const d of snap.docs) {
  const p = d.data();
  try {
    const user = await auth.getUser(d.id);
    if (p.uid !== d.id) {
      console.log("⚠️ El campo uid no coincide con el ID del doc:", d.id, p.uid);
      continue;
    }
    await auth.setCustomUserClaims(d.id, {
      role: p.role,
      dentistId: p.dentistId,
    });
    console.log("OK", user.email, p.role, p.dentistId);
  } catch (e) {
    console.log("ERROR", d.id, e.message);
  }
}