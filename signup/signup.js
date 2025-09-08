// signup.js
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

import { app } from "../firebase-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

function isCompanyEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith("@sioxglobal.com");
}

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const firstName = document.getElementById("firstName").value.trim();
  const lastName = document.getElementById("lastName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const errorDiv = document.getElementById("signupError");
  errorDiv.textContent = "";

  if (!isCompanyEmail(email)) {
    errorDiv.textContent = "You are not part of Organization";
    return;
  }

  if (password !== confirmPassword) {
    errorDiv.textContent = "Passwords do not match.";
    return;
  }

  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    errorDiv.textContent = "Invalid phone number.";
    return;
  }

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // Send verification email (password flow)
    await sendEmailVerification(user);

    // Create Firestore user doc with safe defaults (first creation)
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, {
      uid: user.uid,
      email,
      displayName: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      phone,
      photoURL: user.photoURL || "",
      provider: "password",
      emailVerified: false,

      // Defaults set once
      role: "user",
      companyIds: [],
      features: {
        dashboard: true,
        reports: true,
        users: false,
      },

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    }, { merge: false });

    // Optional: immediately sign out so they must verify before logging in
    await signOut(auth);

    // Redirect to your verify email page
    window.location.href = "../verify-email/verify-email.html";
  } catch (err) {
    errorDiv.textContent = err?.message || "Sign up failed. Please try again.";
  }
});
