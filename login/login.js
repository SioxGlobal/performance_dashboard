// login.js
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

import { app } from "../firebase-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

// ✅ Restrict Google SSO to company domain
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: "sioxglobal.com" });

// Feature flags (expand as you grow; do NOT overwrite on login)
const DEFAULT_FEATURES = {
  dashboard: true,
  reports: true,
  users: false, // admins will have this set true by an admin — not here
};

// ---------- Helpers ----------

// Build safe profile fields from Firebase user object
function parseNameParts(displayName, email) {
  const name = (displayName || (email ? email.split("@")[0] : "") || "").trim();
  const [first, ...rest] = name.split(" ");
  return { firstName: first || "", lastName: rest.length ? rest[rest.length - 1] : "" };
}

function isCompanyEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith("@sioxglobal.com");
}

// Create a new Firestore user doc with defaults (only run on FIRST login/signup)
async function createUserDoc(user) {
  const { firstName, lastName } = parseNameParts(user.displayName, user.email);
  const userRef = doc(db, "users", user.uid);

  await setDoc(userRef, {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    firstName,
    lastName,
    photoURL: user.photoURL || "",
    provider: (user.providerData && user.providerData[0]?.providerId) || "password",
    emailVerified: !!user.emailVerified,

    // ⬇️ Defaults set once on first creation only
    role: "user",               // DO NOT set to "admin" here
    companyIds: [],             // admin can assign later
    features: DEFAULT_FEATURES, // initial feature set

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  }, { merge: false }); // explicit create
}

// Update safe profile fields on every login WITHOUT touching role/companyIds/features
async function updateUserDocOnLogin(user) {
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, {
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    provider: (user.providerData && user.providerData[0]?.providerId) || "password",
    emailVerified: !!user.emailVerified,
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  }, { merge: true }); // safe merge; will NOT overwrite role/companyIds/features
}

// Ensure a user doc exists, then update safe fields; never down-grade roles
async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await createUserDoc(user);        // create with defaults once
  } else {
    await updateUserDocOnLogin(user); // refresh safe fields only
  }

  // (Optional) cache minimal profile to sessionStorage for your dashboard
  try {
    const refreshed = await getDoc(userRef);
    if (refreshed.exists()) {
      const data = refreshed.data();
      sessionStorage.setItem("currentUser", JSON.stringify({
        uid: data.uid,
        email: data.email,
        role: data.role,
        companyIds: data.companyIds || [],
        features: data.features || {},
        displayName: data.displayName || "",
        photoURL: data.photoURL || "",
      }));
    }
  } catch (_) {}
}

// ---------- Event handlers ----------

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorDiv = document.getElementById("error");
  errorDiv.textContent = "";

  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    // Require verified email for password flow
    if (!user.emailVerified) {
      errorDiv.textContent = "Please verify your email before logging in.";
      await signOut(auth);
      return;
    }

    if (!isCompanyEmail(user.email)) {
      errorDiv.textContent = "Only @sioxglobal.com accounts are allowed.";
      await signOut(auth);
      return;
    }

    await ensureUserProfile(user);
    window.location.href = "../dashboard/index.html";
  } catch (err) {
    errorDiv.textContent = err?.message || "Login failed. Please try again.";
  }
});

document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  const errorDiv = document.getElementById("error");
  errorDiv.textContent = "";

  try {
    const { user } = await signInWithPopup(auth, provider);

    if (!isCompanyEmail(user.email)) {
      errorDiv.textContent = "Only company emails are allowed.";
      await signOut(auth);
      return;
    }

    // For Google SSO we usually accept unverified emails (Google has its own checks),
    // but if you want to force verification, uncomment below:
    // if (!user.emailVerified) { ... }

    await ensureUserProfile(user);
    window.location.href = "../dashboard/index.html";
  } catch (err) {
    errorDiv.textContent = err?.message || "Sign-in failed. Please try again.";
  }
});
