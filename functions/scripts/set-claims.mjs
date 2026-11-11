import admin from "firebase-admin";
import fs from "fs";

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync("./serviceAccount.json", "utf8"))
  ),
});

const snap = await admin.firestore().collection("users").get();

for (const d of snap.docs) {
  const p = d.data();
  try {
    const user = await admin.auth().getUser(d.id);
    if (p.uid !== d.id) {
      console.log("⚠️ El campo uid no coincide con el ID del doc:", d.id, p.uid);
      continue;
    }
    await admin.auth().setCustomUserClaims(d.id, {
      role: p.role,
      dentistId: p.dentistId,
    });
    console.log("OK", user.email, p.role, p.dentistId);
  } catch (e) {
    console.log("ERROR", d.id, e.message);
  }
}