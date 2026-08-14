import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile,
  verifyPasswordResetCode
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { auth, db, secondaryAuth, storage } from "./firebase-init.js";

const page = document.body.dataset.page || "home";

// Check if running on localhost (development/testing environment)
const isLocalhost = () => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

// Safe localStorage wrapper — prevents data persistence on localhost
const safeSetStorage = (key, value) => {
  if (isLocalhost()) {
    console.warn(`Storage disabled on localhost: ${key}`);
    return; // Don't store on localhost
  }
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`Failed to set storage: ${key}`, err);
  }
};

const safeGetStorage = (key) => {
  if (isLocalhost()) {
    return null; // Don't retrieve on localhost
  }
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(`Failed to get storage: ${key}`, err);
    return null;
  }
};

const safeRemoveStorage = (key) => {
  if (isLocalhost()) {
    return; // Don't remove on localhost (nothing was stored)
  }
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`Failed to remove storage: ${key}`, err);
  }
};

const THEME_STORAGE_KEY = "bhf_theme";
const CONTENT_STORE_KEY = "bhf_admin_content";
const CERT_TEMPLATE_STORE_KEY = "bhf_certificate_template";
const ENROLLMENT_STORE_KEY = "bhf_user_enrollments";
const COURSE_ACCESS_STORE_KEY = "bhf_course_access_payments";
const PROFILE_PHOTO_STORE_KEY = "bhf_profile_photo";
const USER_CONTACT_STORE_KEY = "bhf_user_contact";
const ADMIN_EMAIL = "admin@bhf.com";
const SUPERADMIN_EMAIL = "superadmin@bhf.com";
const GEMINI_IMAGE_API_KEY = "AQ.Ab8RN6IqpPu0LEGIJR9Vz0UtlGDwkAgX2xYGMwrseVni1U32Gw";
const GEMINI_IMAGE_MODEL = "gemini-flash-2.5";
// WARNING: Embedding an API key in client-side code is not secure for production.
// For a real deployment, proxy Gemini image calls through a server-side endpoint
// and do not publish the secret in browser JavaScript.
const LAST_USER_SNAPSHOT_KEY = "bhf_last_user_snapshot";

// The signed-in-user snapshot is a same-browser UX cache only — it just
// seeds an instant nav-bar paint on the next page and is always overwritten
// / corrected by the real onAuthStateChanged a moment later, so it carries
// none of the "don't leave stale test data behind" risk that
// safeGetStorage/safeSetStorage guard against for other keys. It
// intentionally bypasses the localhost storage block below. Without this,
// every page navigation during local testing (127.0.0.1 / localhost) had to
// wait for a full Firebase round trip before it could show the profile,
// producing a flash of "Login" on every nav click.
const rawGetStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(`Failed to get storage: ${key}`, err);
    return null;
  }
};
const rawSetStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`Failed to set storage: ${key}`, err);
  }
};
const rawRemoveStorage = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`Failed to remove storage: ${key}`, err);
  }
};

const getLastUserSnapshot = () => {
  try {
    const raw = rawGetStorage(LAST_USER_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getStoredTheme = () => {
  try {
    // Uses rawGetStorage (not safeGetStorage) intentionally: theme is a
    // harmless UI preference, not test/user data, so — like the
    // last-signed-in-user snapshot above — it should persist normally even
    // during local (localhost) testing. Without this, clicking the toggle
    // visually changes the current page but silently fails to save,
    // so the very next page navigation reverts to light mode.
    return rawGetStorage(THEME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const saveStoredTheme = (theme) => {
  try {
    rawSetStorage(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures.
  }
};

const getPreferredTheme = () => {
  // Always default to light mode. We intentionally do NOT look at the
  // visitor's OS/browser "prefers-color-scheme" setting here — many phones
  // and browsers default to dark system-wide, which was causing the site to
  // silently boot into dark mode for those visitors even though they never
  // touched the toggle. Dark mode should only ever turn on when the person
  // explicitly clicks the toggle button (see toggleTheme()).
  return "light";
};

const applyTheme = (theme) => {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = resolvedTheme;
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  const toggle = document.getElementById("bhf-theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", resolvedTheme === "dark" ? "true" : "false");
    toggle.textContent = "🌙";
    toggle.title = resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
};

const toggleTheme = () => {
  const currentTheme = document.body.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  saveStoredTheme(nextTheme);
};

const initThemeToggle = () => {
  let toggle = document.getElementById("bhf-theme-toggle");
  // If the toggle doesn't exist yet (on non-admin pages), create it
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.id = "bhf-theme-toggle";
    toggle.type = "button";
    toggle.className = "theme-toggle fixed";
    toggle.setAttribute("aria-label", "Toggle dark mode");
    document.body.appendChild(toggle);
  }

  const storedTheme = getStoredTheme();
  applyTheme(storedTheme || getPreferredTheme());
  toggle.removeEventListener("click", toggleTheme);
  toggle.addEventListener("click", toggleTheme);
};

const saveLastUserSnapshot = (user) => {
  try {
    if (!user) {
      rawRemoveStorage(LAST_USER_SNAPSHOT_KEY);
      return;
    }
    const { uid, email, name, role, photoURL } = user;
    rawSetStorage(LAST_USER_SNAPSHOT_KEY, JSON.stringify({ uid, email, name, role, photoURL }));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

const getUserContact = (uid) => {
  if (!uid) return "";
  try {
    return safeGetStorage(`${USER_CONTACT_STORE_KEY}_${uid}`) || "";
  } catch {
    return "";
  }
};

const saveUserContact = (uid, contact) => {
  if (!uid || typeof contact !== "string") return;
  try {
    safeSetStorage(`${USER_CONTACT_STORE_KEY}_${uid}`, contact.trim());
  } catch {
    // ignore storage errors
  }
};

initThemeToggle();

// Detect whether browser storage (localStorage) is available — some privacy
// settings (Edge Tracking Prevention) or third-party contexts block access.
const checkStorageAccess = () => {
  if (isLocalhost()) {
    console.log('Non-essential storage caches (courses/certificates snapshots) are disabled on localhost for security — this does NOT affect the dark mode toggle, which persists normally on localhost.');
    return true; // Consider it "available" but safeSetStorage will skip it
  }
  try {
    const testKey = '__bhf_storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    console.warn('Local storage access blocked', err);
    notifyUser('Browser prevented access to localStorage/cookies. Allow storage for this site or disable strict tracking protection to use the app reliably.');
    return false;
  }
};

checkStorageAccess();

// Track whether Firestore returned a permission error so we can surface
// a persistent banner with remediation steps in admin pages.
let FIRESTORE_PERMISSION_DENIED = false;

const defaultCertificateTemplate = {
  title: "Certificate",
  subtitle: "◆ of Completion ◆",
  note: "This certifies that",
  programLabel: "Program Completed",
  programMeta: "Online Certification Program",
  signatory: "Baguio Home for the Faithful"
};

const getStoredProfilePhoto = (uid) => {
  if (!uid) return null;
  try {
    return safeGetStorage(`${PROFILE_PHOTO_STORE_KEY}_${uid}`) || null;
  } catch {
    return null;
  }
};

const saveStoredProfilePhoto = (uid, photoUrl) => {
  if (!uid || !photoUrl) return;
  try {
    safeSetStorage(`${PROFILE_PHOTO_STORE_KEY}_${uid}`, photoUrl);
  } catch {
    // Ignore storage issues so the UI can still function.
  }
};

const getCertificateTemplate = () => {
  const stored = safeGetStorage(CERT_TEMPLATE_STORE_KEY);
  try {
    return stored ? { ...defaultCertificateTemplate, ...JSON.parse(stored) } : { ...defaultCertificateTemplate };
  } catch {
    return { ...defaultCertificateTemplate };
  }
};

const saveCertificateTemplate = (template) => {
  safeSetStorage(CERT_TEMPLATE_STORE_KEY, JSON.stringify({ ...defaultCertificateTemplate, ...template }));
};

const resetCertificateTemplate = () => {
  safeRemoveStorage(CERT_TEMPLATE_STORE_KEY);
};

const applyCertificateTemplate = () => {
  const template = getCertificateTemplate();
  const setText = (selector, text) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
  };
  setText('.certificate-main-title', template.title);
  setText('.certificate-subtitle', template.subtitle);
  setText('.certificate-note', template.note);
  setText('.certificate-program-label', template.programLabel);
  setText('.certificate-program-meta', template.programMeta);
  setText('.certificate-signatory', template.signatory);
};

/* =============================================
   Instructor accounts (Firestore-backed "instructors" collection).
   Admins create instructor accounts from the Admin panel. An instructor's
   Firestore doc id is their Firebase Auth uid, so role lookup on login is a
   simple doc read. Instructors can create/manage their own courses, exams,
   and modules but do not get full admin access.
============================================= */
const INSTRUCTOR_COLLECTION = "instructors";
let instructorsCache = [];

const loadInstructorsCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, INSTRUCTOR_COLLECTION));
    instructorsCache = snapshot.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.error("Failed to load instructors from Firestore", error);
    instructorsCache = [];
  }
  return instructorsCache;
};

const getInstructors = () => instructorsCache;

const getInstructorProfile = async (uid) => {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, INSTRUCTOR_COLLECTION, uid));
    return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error("Failed to load instructor profile", error);
    return null;
  }
};

// Creates a Firebase Auth account for a new instructor AND a matching
// Firestore profile doc. Runs the account creation against a secondary
// Firebase App instance so the currently signed-in admin stays logged in.
const createInstructorAccount = async ({ name, email, password }) => {
  const trimmedName = (name || "").trim();
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!trimmedName || !normalizedEmail || !password) {
    throw new Error("Name, email, and password are required.");
  }
  if (normalizedEmail === ADMIN_EMAIL) {
    throw new Error("This email is reserved for admin access.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  const credential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
  try {
    await updateProfile(credential.user, { displayName: trimmedName });
    await setDoc(doc(db, INSTRUCTOR_COLLECTION, credential.user.uid), {
      name: trimmedName,
      email: normalizedEmail,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.uid || null,
      active: true
    });
  } finally {
    // Always sign the secondary session back out, regardless of outcome, so
    // it never lingers as an authenticated session in this browser tab.
    await signOut(secondaryAuth).catch(() => {});
  }
  await loadInstructorsCache();
  return credential.user.uid;
};

// Revokes portal access by removing the Firestore profile doc. The
// Firebase Auth account itself is left intact (client SDKs cannot delete
// other users' auth accounts), but without a Firestore doc the person will
// no longer resolve to the "instructor" role on login.
const removeInstructorAccount = async (uid) => {
  if (!uid) return;

  const instructorRef = doc(db, INSTRUCTOR_COLLECTION, uid);
  const instructorSnap = await getDoc(instructorRef);
  const instructorData = instructorSnap.exists() ? instructorSnap.data() : null;

  await deleteDoc(instructorRef);

  if (instructorData?.email) {
    const userEmail = (instructorData.email || "").trim().toLowerCase();
    if (userEmail) {
      await deleteDoc(doc(db, "users", userEmail)).catch(() => {});
    }
  }

  await loadInstructorsCache();
};


let currentUser = null; // { uid, email, name, role }
let resolveAuthReady;
const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

// Every account (student, instructor, or admin) gets a lightweight profile
// doc in the "users" collection on login. This is what the admin dashboard
// counts for "Total Users" — it can't be derived from Firebase Auth alone
// because listing Auth users requires a backend Admin SDK, and it can't be
// derived from "enrollments" alone because plenty of accounts sign up
// without ever enrolling in a course. Using { merge: true } means this also
// silently backfills a Firestore profile for accounts that were created
// before this doc existed, the next time they log in.
const syncUserProfile = async (user, role, name) => {
  if (!user?.uid) return;
  const emailKey = (user.email || "").trim().toLowerCase();
  if (!emailKey) return;
  try {
    const existing = await getDoc(doc(db, "users", emailKey));
    await setDoc(doc(db, "users", emailKey), {
      uid: user.uid,
      name: name || "",
      email: emailKey,
      role,
      createdAt: existing.exists() ? (existing.data().createdAt || new Date().toISOString()) : new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to sync user profile", error);
  }
};

// Reads the "users/{email}" Firestore doc so contact number and profile
// photo follow the learner to any computer/browser they sign in on,
// instead of living only in that one browser's localStorage.
const getUserProfileDoc = async (email) => {
  const emailKey = (email || "").trim().toLowerCase();
  if (!emailKey) return null;
  try {
    const snap = await getDoc(doc(db, "users", emailKey));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.error("Failed to load user profile from Firestore", error);
    return null;
  }
};

// Writes one or more profile fields (e.g. { contact } or { photoURL }) to
// the learner's "users/{email}" Firestore doc so they sync across devices.
const saveUserProfileFields = async (email, fields) => {
  const emailKey = (email || "").trim().toLowerCase();
  if (!emailKey) return;
  try {
    await setDoc(doc(db, "users", emailKey), fields, { merge: true });
  } catch (error) {
    console.error("Failed to save user profile fields to Firestore", error);
  }
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const email = (user.email || "").toLowerCase();
    let role = "user";
    let instructorProfile = null;
    if (email === SUPERADMIN_EMAIL) {
      role = "superadmin";
    } else if (email === ADMIN_EMAIL) {
      role = "admin";
    } else {
      instructorProfile = await getInstructorProfile(user.uid);
      if (instructorProfile && instructorProfile.active !== false) {
        role = "instructor";
      }
    }
    const displayName = user.displayName || instructorProfile?.name || (email === ADMIN_EMAIL || email === SUPERADMIN_EMAIL ? "Admin" : email.split("@")[0]);
    // Cross-device source of truth for contact number / photo — falls back
    // to this browser's localStorage only for old data saved before this
    // Firestore doc existed.
    const profileDoc = await getUserProfileDoc(user.email);
    currentUser = {
      uid: user.uid,
      email: user.email,
      name: displayName,
      role,
      contact: profileDoc?.contact || getUserContact(user.uid) || "",
      photoURL: user.photoURL || profileDoc?.photoURL || getStoredProfilePhoto(user.uid) || null
    };
    // Fire-and-forget: don't block login/render on this write.
    syncUserProfile(user, role, displayName);
  } else {
    currentUser = null;
  }
  // Keep the optimistic-render cache in sync with the real, confirmed auth
  // state so the next page navigation can render instantly and correctly.
  saveLastUserSnapshot(currentUser);
  resolveAuthReady();
  updateHeaderAuthLink();
});

/* =============================================
   Firestore-backed course catalog (replaces old
   localStorage "bhf_course_catalog")
============================================= */
// Same-browser UX cache of the last known course list — mirrors
// CATEGORIES_SNAPSHOT_KEY below. Without this, coursesCache always started
// as an empty array on every page load/reload, so a freshly-uploaded course
// (e.g. Civil Engineering) couldn't appear until a full Firestore round
// trip completed — the few-seconds delay reported. Seeding synchronously
// from this snapshot means the very first render already has the last
// known-good course list, and watchCourses() below corrects/updates it the
// moment Firestore responds, with no visible delay or reload required.
const COURSES_SNAPSHOT_KEY = "bhf_courses_snapshot";

const getCoursesSnapshot = () => {
  try {
    const raw = rawGetStorage(COURSES_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveCoursesSnapshot = (courses) => {
  try {
    rawSetStorage(COURSES_SNAPSHOT_KEY, JSON.stringify(courses || []));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

// Seeded immediately (before any Firestore call has a chance to resolve)
// so the first render on this page load already reflects the last known
// course list instead of an empty one.
let coursesCache = getCoursesSnapshot();
let resolveCoursesReady;
const coursesReadyPromise = new Promise((resolve) => {
  resolveCoursesReady = resolve;
});

const loadCoursesCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, "courses"));
    coursesCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    saveCoursesSnapshot(coursesCache);
  } catch (error) {
    console.error("Failed to load courses from Firestore", error);
  } finally {
    resolveCoursesReady();
  }
};

let coursesUnsubscribe = null;
// Realtime listener for courses (mirrors watchCategories() below). Resolves
// after the first snapshot so callers can still `await` the initial load
// via dataReadyPromise, but — unlike the old one-shot getDocs() version —
// it keeps pushing updates for as long as the page stays open, mirrors
// every update into localStorage (see COURSES_SNAPSHOT_KEY) so the *next*
// page load/reload starts from fresh data, and dispatches a
// "courses:updated" event so any already-rendered page (home, programs)
// can refresh instantly instead of waiting for a reload.
const watchCourses = () => {
  return new Promise((resolve) => {
    try {
      if (coursesUnsubscribe) {
        resolve();
        return;
      }
      coursesUnsubscribe = onSnapshot(collection(db, "courses"), (snapshot) => {
        coursesCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        saveCoursesSnapshot(coursesCache);
        try { document.dispatchEvent(new CustomEvent('courses:updated')); } catch (e) {}
        resolveCoursesReady();
        resolve();
      }, (err) => {
        console.warn('watchCourses error', err);
        resolveCoursesReady(); // don't block coursesReadyPromise/dataReadyPromise forever on a listener error
        resolve();
      });
    } catch (err) {
      console.warn('Failed to start courses listener', err);
      resolveCoursesReady();
      resolve();
    }
  });
};

/* =============================================
   Program categories stored in Firestore so admins
   can manage them from the Admin panel.
============================================= */

// Same-browser UX cache of the last known categories list — mirrors
// LAST_USER_SNAPSHOT_KEY above. categoriesCache resets to [] on every page
// navigation (it's just a JS variable, and each page is a fresh script
// load), so without this, a returning visit to programs.html or the
// homepage always had to sit through a full Firestore round trip before a
// newly-added category could appear — that round trip was the "few
// seconds" delay. Seeding synchronously from this cache means the very
// first render already has last-known-good data, and the realtime listener
// below (watchCategories) corrects/updates it as soon as Firestore
// responds, with no full page reload required. Intentionally bypasses the
// localhost storage block for the same reason getLastUserSnapshot() does.
const CATEGORIES_SNAPSHOT_KEY = "bhf_categories_snapshot";

const getCategoriesSnapshot = () => {
  try {
    const raw = rawGetStorage(CATEGORIES_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveCategoriesSnapshot = (categories) => {
  try {
    rawSetStorage(CATEGORIES_SNAPSHOT_KEY, JSON.stringify(categories || []));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

// Seeded immediately (before any Firestore call has a chance to resolve)
// so the first render on this page load already reflects the last known
// category list instead of an empty one.
let categoriesCache = getCategoriesSnapshot();

let categoriesUnsubscribe = null;
// Realtime listener for categories (mirrors watchCertificates() above).
// Resolves after the first snapshot so callers can still `await` the
// initial load via dataReadyPromise, but — unlike the old one-shot
// getDocs() version — it keeps pushing updates for as long as the page
// stays open, mirrors every update into localStorage (see
// CATEGORIES_SNAPSHOT_KEY) so the *next* page load starts from fresh data,
// and dispatches a "categories:updated" event so any already-rendered page
// can refresh instantly instead of waiting for a reload.
const watchCategories = () => {
  return new Promise((resolve) => {
    try {
      if (categoriesUnsubscribe) {
        resolve();
        return;
      }
      categoriesUnsubscribe = onSnapshot(collection(db, "categories"), (snapshot) => {
        categoriesCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        saveCategoriesSnapshot(categoriesCache);
        try { document.dispatchEvent(new CustomEvent('categories:updated')); } catch (e) {}
        resolve();
      }, (err) => {
        console.warn('watchCategories error', err);
        resolve(); // don't block dataReadyPromise forever on a listener error
      });
    } catch (err) {
      console.warn('Failed to start categories listener', err);
      resolve();
    }
  });
};

// Categories hidden site-wide regardless of what's saved in Firestore.
// (Add more lowercase names here if other categories need to be hidden.)
const HIDDEN_CATEGORY_NAMES = new Set(["engineering", "architect", "fasdfsadf", "custom programs", "hey"]);

const getSavedCategories = () =>
  categoriesCache.filter((c) => !HIDDEN_CATEGORY_NAMES.has((c.name || "").trim().toLowerCase()));

const normalizeCategoryName = (name) => (name || "").trim().toLowerCase();

const addSavedCategory = async (name) => {
  const normalized = normalizeCategoryName(name);
  if (!normalized) throw new Error("Invalid category name");
  const existing = categoriesCache.find((c) => normalizeCategoryName(c.name) === normalized);
  if (existing) return existing;
  const trimmedName = name.trim();
  const docRef = await addDoc(collection(db, "categories"), { name: trimmedName });
  // Update the local cache (and its localStorage mirror) immediately with
  // the doc we just created, instead of waiting for the realtime listener's
  // own round trip to echo it back — that's what made a newly added
  // category take a moment to show up even on the page that added it. The
  // listener above still receives this same change shortly after and
  // reconciles the cache (and pushes it to every other open tab/page too).
  const newCategory = { id: docRef.id, name: trimmedName };
  categoriesCache.push(newCategory);
  saveCategoriesSnapshot(categoriesCache);
  try { document.dispatchEvent(new CustomEvent('categories:updated')); } catch (e) {}
  return newCategory;
};

// Updates a category's own Firestore doc (e.g. its "img" field) rather than
// a page-scoped selector override. Mirrors updateSavedCourse's reasoning:
// category cards on both the Home and Programs pages are rebuilt from
// scratch on every render (search, live category/course updates, async
// data load), so a positional CSS-selector override can't reliably survive
// that. Writing straight to the category doc makes it the single source of
// truth — the new image shows up everywhere that category is rendered
// (Home's Featured Programs AND Programs' full list) and survives reloads.
const updateSavedCategory = async (name, updates) => {
  const normalized = normalizeCategoryName(name);
  const existing = categoriesCache.find((c) => normalizeCategoryName(c.name) === normalized);
  if (!existing) return null;
  await updateDoc(doc(db, "categories", existing.id), updates);
  // Update the local cache (and its localStorage mirror) immediately,
  // same reasoning as addSavedCategory/removeSavedCategory above.
  categoriesCache = categoriesCache.map((c) => (c.id === existing.id ? { ...c, ...updates } : c));
  saveCategoriesSnapshot(categoriesCache);
  try { document.dispatchEvent(new CustomEvent('categories:updated')); } catch (e) {}
  return categoriesCache.find((c) => c.id === existing.id) || null;
};

const removeSavedCategory = async (name) => {
  const normalized = normalizeCategoryName(name);
  const existing = categoriesCache.find((c) => normalizeCategoryName(c.name) === normalized);
  if (existing) {
    await deleteDoc(doc(db, "categories", existing.id));
    // Same reasoning as addSavedCategory: update the cache (and its
    // localStorage mirror) locally rather than waiting on the listener.
    categoriesCache = categoriesCache.filter((c) => c.id !== existing.id);
    saveCategoriesSnapshot(categoriesCache);
    try { document.dispatchEvent(new CustomEvent('categories:updated')); } catch (e) {}
  }
  return categoriesCache;
};

/* =============================================
   Server-backed content overrides so admin edits persist
   across devices and visitors.
============================================= */
// Same-browser instant-paint cache, mirroring COURSES_SNAPSHOT_KEY /
// CATEGORIES_SNAPSHOT_KEY above. Without this, overridesCache always
// started as an empty {} on every page load, so applyContentOverrides()'s
// very first (synchronous) call always ran before loadOverridesCache()'s
// Firestore fetch could return — the page briefly showed the original/
// default text or image, then "flashed" to the saved edit a moment later
// once the network round trip finished. Seeding synchronously from this
// snapshot means the very first render already reflects the last-known
// saved edits, with loadOverridesCache() below only correcting it (silently,
// with no visible flash) if something changed since the last visit. Uses
// rawGetStorage/rawSetStorage (not safeGetStorage/safeSetStorage) so it
// still works during local Live Server testing, exactly like the courses
// and categories snapshots do.
const OVERRIDES_SNAPSHOT_KEY = "bhf_overrides_snapshot";

const getOverridesSnapshot = () => {
  try {
    const raw = rawGetStorage(OVERRIDES_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveOverridesSnapshot = (overrides) => {
  try {
    rawSetStorage(OVERRIDES_SNAPSHOT_KEY, JSON.stringify(overrides || {}));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

let overridesCache = getOverridesSnapshot();

const loadOverridesCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, "overrides"));
    const map = {};
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const pageKey = data.page || "home";
      map[pageKey] = map[pageKey] || {};
      map[pageKey][data.selector] = { type: data.type, value: data.value, id: docSnap.id };
    });
    overridesCache = map;
    saveOverridesSnapshot(overridesCache);
  } catch (error) {
    console.error("Failed to load overrides from Firestore", error);
    // Keep whatever was already in overridesCache (the local snapshot seeded
    // above) instead of wiping it to {} — a failed refresh shouldn't blank
    // out edits that were showing correctly a moment ago.
  }
};

const saveRemoteOverride = async (pageKey, selector, entry) => {
  try {
    const q = query(collection(db, "overrides"), where("page", "==", pageKey), where("selector", "==", selector));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      await updateDoc(doc(db, "overrides", snapshot.docs[0].id), { page: pageKey, selector, ...entry });
    } else {
      await addDoc(collection(db, "overrides"), { page: pageKey, selector, ...entry });
    }
    await loadOverridesCache();
  } catch (err) {
    console.error("Failed to save override to Firestore", err);
    throw err;
  }
};

const removeRemoteOverride = async (pageKey, selector) => {
  try {
    const q = query(collection(db, "overrides"), where("page", "==", pageKey), where("selector", "==", selector));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      await deleteDoc(doc(db, "overrides", snapshot.docs[0].id));
      await loadOverridesCache();
    }
  } catch (err) {
    console.error("Failed to remove override from Firestore", err);
    throw err;
  }
};

const normalizeCourseTitle = (title) => {
  return (title || "").trim().toLowerCase();
};

// Synchronous read from the in-memory cache that loadCoursesCache() fills
// from Firestore on startup. Kept synchronous so all the existing render
// functions below don't need to change.
// Courses hidden site-wide regardless of what's saved in Firestore.
// (Add more lowercase titles here if other courses need to be hidden.)
const HIDDEN_COURSE_TITLES = new Set(["engineer foundations (free)"]);

const getSavedCourses = () =>
  coursesCache.filter((c) => !HIDDEN_COURSE_TITLES.has((c.title || "").trim().toLowerCase()));

const findSavedCourse = (title) => {
  const normalized = normalizeCourseTitle(title);
  return coursesCache.find((course) => normalizeCourseTitle(course.title) === normalized) || null;
};

const isBuiltInCourseTitle = (title) => {
  const normalized = normalizeCourseTitle(title);
  return Array.isArray(BHF_COURSES)
    ? BHF_COURSES.some((course) => normalizeCourseTitle(course.title) === normalized)
    : false;
};

const updateSavedCourse = async (title, updates) => {
  const normalized = normalizeCourseTitle(title);
  const existing = coursesCache.find((item) => normalizeCourseTitle(item.title) === normalized);
  if (!existing) return null;
  await updateDoc(doc(db, "courses", existing.id), updates);
  // Automatically save the new category if it's being updated
  if (updates.category) {
    try {
      await addSavedCategory(updates.category);
    } catch (err) {
      console.warn('Failed to save course category:', err);
    }
  }
  await loadCoursesCache();
  return findSavedCourse(title);
};

const removeSavedCourse = async (title) => {
  const normalized = normalizeCourseTitle(title);
  const existing = coursesCache.find((item) => normalizeCourseTitle(item.title) === normalized);
  if (existing) {
    if (isBuiltInCourseTitle(title)) {
      // If this saved course overrides a built-in default, keep the record but
      // mark it inactive so the default course does not reappear in the catalog.
      await updateDoc(doc(db, "courses", existing.id), { active: false });
    } else {
      await deleteDoc(doc(db, "courses", existing.id));
    }
    await loadCoursesCache();
  }
  return coursesCache;
};

const addSavedCourse = async (course) => {
  const normalized = normalizeCourseTitle(course.title);
  const existing = coursesCache.find((item) => normalizeCourseTitle(item.title) === normalized);
  if (existing) {
    await updateDoc(doc(db, "courses", existing.id), course);
  } else {
    await addDoc(collection(db, "courses"), course);
  }
  // Automatically save the course category if it doesn't exist
  if (course.category) {
    try {
      await addSavedCategory(course.category);
    } catch (err) {
      console.warn('Failed to save course category:', err);
    }
  }
  await loadCoursesCache();
  return course;
};

const getCourseCatalog = () => {
  const saved = getSavedCourses();
  const savedMap = saved.reduce((map, course) => {
    map[normalizeCourseTitle(course.title)] = course;
    return map;
  }, {});

  const base = typeof BHF_COURSES !== "undefined"
    ? BHF_COURSES.map((course) => savedMap[normalizeCourseTitle(course.title)] || course)
    : [];

  const extra = saved.filter(
    (course) => !base.some((baseCourse) => normalizeCourseTitle(baseCourse.title) === normalizeCourseTitle(course.title))
  );

  return [...base, ...extra];
};

const ensurePdfWorker = () => {
  if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }
};

const extractTextFromPdfBytes = async (bytes) => {
  if (!window.pdfjsLib || !pdfjsLib.getDocument) {
    throw new Error('PDF.js library is not loaded.');
  }
  ensurePdfWorker();
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // pdf.js gives us each text fragment with its own position on the page
    // (item.transform[5] is the fragment's Y coordinate). The old code just
    // joined every fragment on a page with a single space, which collapsed
    // an entire page — headings, paragraphs, quiz options, everything —
    // into one unbroken line. That made line-anchored parsing (module
    // headings, "Q:" questions, "A)" options, "Answer:" lines) impossible
    // to detect unless each one sat on its own PDF page.
    //
    // Instead, group fragments into rows by Y position (allowing a small
    // tolerance for sub-pixel jitter within the same visual line), and join
    // rows with newlines. This reconstructs the PDF's real line breaks so
    // multi-line content (module body text, quiz Q/A/Answer blocks) on a
    // single page parses correctly.
    const items = content.items.filter((item) => item.str !== undefined);
    const rows = [];
    let currentRow = null;
    let currentY = null;
    const Y_TOLERANCE = 2.5;
    items.forEach((item) => {
      const y = item.transform ? item.transform[5] : 0;
      if (currentRow && currentY !== null && Math.abs(y - currentY) <= Y_TOLERANCE) {
        currentRow.push(item.str);
      } else {
        if (currentRow) rows.push(currentRow.join(''));
        currentRow = [item.str];
        currentY = y;
      }
    });
    if (currentRow) rows.push(currentRow.join(''));
    pageTexts.push(rows.join('\n'));
  }
  await pdf.destroy();
  return pageTexts.join('\n');
};

const parseCourseTextFromPdf = (text) => {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  const modules = [];
  const questions = [];
  let currentModule = null;
  let currentQuestion = null;
  let mode = 'module';

  const closeCurrentQuestion = () => {
    if (currentQuestion) {
      if (currentQuestion.options.length < 4) {
        while (currentQuestion.options.length < 4) {
          currentQuestion.options.push('Option placeholder');
        }
      }
      if (currentQuestion.answer == null) {
        currentQuestion.answer = 0;
      }
      if (mode === 'exam') {
        questions.push(currentQuestion);
      } else if (mode === 'module-quiz' && currentModule) {
        currentModule.quiz = currentModule.quiz || [];
        currentModule.quiz.push(currentQuestion);
      } else {
        questions.push(currentQuestion);
      }
      currentQuestion = null;
    }
  };

  const closeCurrentModule = () => {
    if (currentQuestion) closeCurrentQuestion();
    if (currentModule) {
      currentModule.content = currentModule.content.trim();
      modules.push(currentModule);
      currentModule = null;
    }
  };

  const normalizeAnswer = (raw) => {
    const normalized = raw.trim().toUpperCase();
    // Look for a standalone option letter A-D — allowing it to be wrapped in
    // common punctuation ("B)", "(B)", "D.") or followed by more text
    // ("C — because...", "Option B") — rather than requiring the answer
    // line to contain nothing but a single bare letter. That stricter
    // check was the bug: any real-world PDF answer key formatted as
    // anything other than a lone "A"/"B"/"C"/"D" fell through to the
    // numeric branch below, found no digits, and silently defaulted to 0
    // regardless of the actual correct answer.
    const letterMatch = normalized.match(/(?:^|[\s:\-.,()])([A-D])(?:$|[\s.\-,()])/);
    if (letterMatch) {
      return ['A', 'B', 'C', 'D'].indexOf(letterMatch[1]);
    }
    const numeric = parseInt(normalized.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(numeric) && numeric >= 1 ? Math.max(0, numeric - 1) : 0;
  };

  // Requires a colon/dash/period (with optional digits) right after the
  // keyword, e.g. "Module 1:" or "Module:" or "Lesson 2 -". This avoids
  // false-matching an ordinary sentence that happens to start with the
  // word "module" after line wrapping (e.g. "...The module also covers...").
  const moduleHeadingRegex = /^(?:Module|Lesson|Chapter)\s*(?:\d+\s*)?[:\-.]\s*(.*)$/i;
  const quizHeadingRegex = /^(?:Module\s*Quiz|Quiz|Review\s*Quiz|Practice\s*Quiz)[:]?\s*(.*)$/i;
  const examHeadingRegex = /^(?:Final\s*Exam|Certification\s*Exam|Exam|Assessment|Practice\s*Test)[:]?\s*(.*)$/i;
  const questionHeadingRegex = /^(?:Q(?:uestion)?\s*\d*[:\-.]?\s*)(.*\?)$/i;
  const numberedQuestionRegex = /^(?:\d+\.|\d+\))\s*(.*\?)$/i;
  const optionRegex = /^[*✓✔✅]?\s*(?:[A-D]|\d+)\s*[\).:-]\s*(.+)$/i;
  const answerRegex = /^(?:Answer|Correct(?:\s*Answer)?|Solution|Key)[:]?\s*(.+)$/i;

  lines.forEach((line) => {
    const moduleMatch = line.match(moduleHeadingRegex);
    const quizMatch = line.match(quizHeadingRegex);
    const examMatch = line.match(examHeadingRegex);
    const questionMatch = line.match(questionHeadingRegex) || line.match(numberedQuestionRegex);
    const optionMatch = line.match(optionRegex);
    const answerMatch = line.match(answerRegex);

    if (moduleMatch && moduleMatch[1]) {
      closeCurrentModule();
      currentModule = { title: moduleMatch[1].trim() || `Module ${modules.length + 1}`, content: '', quiz: [] };
      mode = 'module';
      return;
    }

    if (quizMatch) {
      closeCurrentQuestion();
      mode = 'module-quiz';
      if (!currentModule) {
        currentModule = { title: `Module ${modules.length + 1}`, content: '', quiz: [] };
      }
      return;
    }

    if (examMatch) {
      closeCurrentQuestion();
      closeCurrentModule();
      mode = 'exam';
      return;
    }

    if (answerMatch) {
      if (currentQuestion) {
        currentQuestion.answer = normalizeAnswer(answerMatch[1]);
      }
      return;
    }

    if (questionMatch) {
      closeCurrentQuestion();
      const questionText = questionMatch[1].trim();
      // `answer` starts as null (not 0) so we can tell "no correct answer
      // found yet" apart from "found, and it happens to be option A/0".
      // closeCurrentQuestion() is what falls back to 0 if nothing ever
      // marks a correct answer for this question.
      currentQuestion = { q: questionText, options: [], answer: null };
      return;
    }

    if (optionMatch && currentQuestion) {
      // Many PDFs mark the correct option inline instead of (or in addition
      // to) a separate "Answer: X" line — e.g. "B) Paris*", "*B) Paris",
      // "✓ B) Paris", "B) Paris (correct)", "B) Paris - correct answer".
      // Detect those markers here and record the option's index directly,
      // so the answer isn't silently left at the default (0) when the PDF
      // never actually said "A" or "0" was correct.
      const hasLeadingMarker = /^[*✓✔]/.test(line);
      let optionText = optionMatch[1].trim();
      const hasTrailingMarker =
        /[*✓✔]$/.test(optionText) ||
        /\(\s*correct(?:\s*answer)?\s*\)$/i.test(optionText) ||
        /\[\s*correct(?:\s*answer)?\s*\]$/i.test(optionText) ||
        /[-–—]\s*correct(?:\s*answer)?$/i.test(optionText);

      if (hasTrailingMarker) {
        optionText = optionText
          .replace(/[*✓✔]+$/, '')
          .replace(/\(\s*correct(?:\s*answer)?\s*\)$/i, '')
          .replace(/\[\s*correct(?:\s*answer)?\s*\]$/i, '')
          .replace(/[-–—]\s*correct(?:\s*answer)?$/i, '')
          .trim();
      }

      if (hasLeadingMarker || hasTrailingMarker) {
        currentQuestion.answer = currentQuestion.options.length;
      }

      currentQuestion.options.push(optionText);
      return;
    }

    if (currentQuestion && line.endsWith('?') && currentQuestion.options.length === 0) {
      // Some PDFs may split question text across lines.
      currentQuestion.q = `${currentQuestion.q} ${line}`.trim();
      return;
    }

    if (currentModule && mode === 'module') {
      currentModule.content += `${line} `;
    }
  });

  closeCurrentQuestion();
  closeCurrentModule();

  if (!modules.length && text.trim()) {
    modules.push({ title: 'Module 1', content: text.trim(), quiz: [] });
  }

  return {
    modules: modules.map((module, index) => ({
      title: module.title || `Module ${index + 1}`,
      content: module.content || '',
      quiz: Array.isArray(module.quiz) ? module.quiz : []
    })),
    questions: questions.map((question) => ({
      q: question.q || 'Question',
      options: question.options.length ? question.options : ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
      answer: Number.isFinite(question.answer) ? question.answer : 0
    }))
  };
};

const parseCoursePdfIntoCourseData = async ({ file, url }) => {
  const sourceBytes = file ? await file.arrayBuffer() : null;
  if (!sourceBytes && url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Unable to download PDF from provided URL.');
    }
    const buffer = await response.arrayBuffer();
    return parseCourseTextFromPdf(await extractTextFromPdfBytes(buffer));
  }
  if (!sourceBytes) {
    throw new Error('No PDF source provided for parsing.');
  }
  const text = await extractTextFromPdfBytes(sourceBytes);
  return parseCourseTextFromPdf(text);
};

const getEnrollments = () => {
  const stored = safeGetStorage(ENROLLMENT_STORE_KEY);
  try {
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveEnrollments = (enrollments) => {
  safeSetStorage(ENROLLMENT_STORE_KEY, JSON.stringify(enrollments));
};

const getCourseHistoryMetadata = (title) => {
  const normalizedTitle = normalizeCourseTitle(title);
  const course = getCourseCatalog().find((item) => normalizeCourseTitle(item.title) === normalizedTitle) || {};
  const deliveryType = course.type || (course.accessRule === 'free' ? 'Self-Paced' : course.accessRule === 'paid' ? 'Instructor-Led' : 'Course');
  return {
    courseImage: course.img || course.image || '',
    courseDesc: course.desc || course.description || '',
    courseType: deliveryType,
    courseLevel: course.level || '',
    courseDuration: course.duration || '',
    institution: course.category || 'BHF Academy'
  };
};

const getUserEnrollmentHistory = (email) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) return [];

  const localEnrollments = getEnrollments();
  const savedCourseTitles = Array.isArray(localEnrollments[normalizedEmail])
    ? localEnrollments[normalizedEmail]
    : [];

  const firestoreRecords = Array.isArray(getEnrollmentRecords?.())
    ? getEnrollmentRecords().filter((record) => (record.email || "").toLowerCase() === normalizedEmail)
    : [];

  const certificateRecords = getUserCertificates(normalizedEmail);

  const historyMap = new Map();

  savedCourseTitles.forEach((title) => {
    const normalizedTitle = (title || "").trim().toLowerCase();
    if (!normalizedTitle) return;
    if (!historyMap.has(normalizedTitle)) {
      const metadata = getCourseHistoryMetadata(String(title || "Untitled Course"));
      historyMap.set(normalizedTitle, {
        title: String(title || "Untitled Course"),
        status: "In progress",
        category: metadata.institution || "",
        startDate: "",
        endDate: "",
        completionDate: "",
        source: "local",
        courseImage: metadata.courseImage,
        courseDesc: metadata.courseDesc,
        courseType: metadata.courseType,
        courseLevel: metadata.courseLevel,
        courseDuration: metadata.courseDuration
      });
    }
  });

  firestoreRecords.forEach((record) => {
    const title = String(record.course || record.title || "Untitled Course");
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle) return;

    const existing = historyMap.get(normalizedTitle) || {};
    const metadata = getCourseHistoryMetadata(title);
    historyMap.set(normalizedTitle, {
      title,
      status: record.status || existing.status || "In progress",
      category: record.category || existing.category || metadata.institution || "",
      startDate: record.enrolledAt || existing.startDate || record.startDate || "",
      endDate: record.courseEndDate || existing.endDate || record.endDate || "",
      completionDate: existing.completionDate || "",
      source: "firestore",
      courseImage: existing.courseImage || metadata.courseImage,
      courseDesc: existing.courseDesc || metadata.courseDesc,
      courseType: existing.courseType || metadata.courseType,
      courseLevel: existing.courseLevel || metadata.courseLevel,
      courseDuration: existing.courseDuration || metadata.courseDuration
    });
  });

  certificateRecords.forEach((certificate) => {
    const title = String(certificate.course || certificate.title || "Untitled Course");
    const normalizedTitle = title.trim().toLowerCase();
    if (!normalizedTitle) return;

    const existing = historyMap.get(normalizedTitle) || {};
    const metadata = getCourseHistoryMetadata(title);
    const completionDate = certificate.date || certificate.issuedAt || existing.completionDate || "";
    historyMap.set(normalizedTitle, {
      title,
      status: certificate.valid ? "Completed" : "Certificate Issued",
      category: existing.category || certificate.category || metadata.institution || "",
      startDate: existing.startDate || certificate.enrolledAt || certificate.startDate || certificate.date || certificate.issuedAt || "",
      endDate: existing.endDate || certificate.expiryDate || certificate.endDate || "",
      completionDate,
      certificateCode: certificate.code || existing.certificateCode || "",
      source: "certificate",
      courseImage: existing.courseImage || metadata.courseImage,
      courseDesc: existing.courseDesc || metadata.courseDesc,
      courseType: existing.courseType || metadata.courseType,
      courseLevel: existing.courseLevel || metadata.courseLevel,
      courseDuration: existing.courseDuration || metadata.courseDuration
    });
  });

  const history = Array.from(historyMap.values());

  return history.sort((a, b) => {
    const aTime = a.completionDate ? Date.parse(a.completionDate) : (a.endDate ? Date.parse(a.endDate) : 0);
    const bTime = b.completionDate ? Date.parse(b.completionDate) : (b.endDate ? Date.parse(b.endDate) : 0);
    if (aTime !== bTime) return bTime - aTime;
    return (a.title || "").localeCompare(b.title || "");
  });
};

const getCourseAccessPayments = (email) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) return {};
  const stored = safeGetStorage(COURSE_ACCESS_STORE_KEY);
  try {
    const data = stored ? JSON.parse(stored) : {};
    return data[normalizedEmail] || {};
  } catch {
    return {};
  }
};

const saveCourseAccessPayments = (email, payments) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  const stored = safeGetStorage(COURSE_ACCESS_STORE_KEY);
  try {
    const data = stored ? JSON.parse(stored) : {};
    data[normalizedEmail] = payments;
    safeSetStorage(COURSE_ACCESS_STORE_KEY, JSON.stringify(data));
  } catch {
    const data = {};
    data[normalizedEmail] = payments;
    safeSetStorage(COURSE_ACCESS_STORE_KEY, JSON.stringify(data));
  }
};

const hasPurchasedCourseAccess = (courseTitle, email) => {
  const normalizedTitle = normalizeCourseTitle(courseTitle);
  const payments = getCourseAccessPayments(email);
  if (payments && payments[normalizedTitle]) return true;

  // Fallback: if an enrollment record exists in the Firestore-backed
  // enrollments cache with paid=true, treat that as access granted.
  try {
    if (typeof getEnrollmentRecords === 'function') {
      const records = getEnrollmentRecords() || [];
      const normalizedEmail = (email || "").trim().toLowerCase();
      return records.some((r) => (r.email || "").toLowerCase() === normalizedEmail && normalizeCourseTitle(r.course || r.title || "") === normalizedTitle && Boolean(r.paid));
    }
  } catch (err) {
    // ignore and fall through
  }
  return false;
};

const markCourseAccessPaid = (courseTitle, email) => {
  const normalizedTitle = normalizeCourseTitle(courseTitle);
  const payments = getCourseAccessPayments(email);
  payments[normalizedTitle] = {
    paidAt: new Date().toISOString(),
    courseTitle: courseTitle?.trim() || normalizedTitle
  };
  saveCourseAccessPayments(email, payments);
  return payments[normalizedTitle];
};

const courseRequiresPayment = (course) => {
  // The instructor's explicit Free/Paid choice (accessRule) always wins.
  // Only fall back to guessing from the course level for older courses
  // that were saved before this field existed.
  if (course?.accessRule === "free" || course?.accessRule === "paid") {
    return course.accessRule === "paid";
  }
  const level = (course?.level || "Intermediate").toLowerCase();
  return level === "intermediate" || level === "advanced";
};

const canAccessCourse = (course, email) => {
  if (!courseRequiresPayment(course)) return true;
  return hasPurchasedCourseAccess(course?.title || course?.course || "", email);
};

const canAccessCertificate = (course, email) => {
  return hasPurchasedCourseAccess(course?.title || course?.course || "", email);
};

const mergeCoursesWithSaved = (defaultCourses) => {
  const savedCourses = getSavedCourses();
  const normalizedSaved = savedCourses.reduce((map, course) => {
    map[normalizeCourseTitle(course.title)] = course;
    return map;
  }, {});

  const merged = defaultCourses.map((course) => {
    const saved = normalizedSaved[normalizeCourseTitle(course.title)];
    return saved ? { ...course, ...saved } : course;
  });

  const extraSaved = savedCourses.filter(
    (course) => !merged.some((item) => normalizeCourseTitle(item.title) === normalizeCourseTitle(course.title))
  );

  // Filter out inactive courses from display (active defaults to true if not set)
  const allCourses = [...merged, ...extraSaved];
  return allCourses.filter((course) => course.active !== false);
};

/* =============================================
   BHF Course Catalog (defined early for page logic)
   Edit titles, descriptions, and images here —
   both programs.html and course-detail.html read
   from this single list.
============================================= */
const BHF_COURSES = [
  // Add your own course entries here, e.g.:
  // { title: "Your Course Title", category: "Your Category",
  //   desc: "Course description here.",
  //   img: "https://example.com/image.jpg",
  //   learning: [
  //     "Learning outcome 1",
  //     "Learning outcome 2"
  //   ]
  // },
];

/* =============================================
   Generic placeholder lesson modules per course.
   Each module now includes detailed content and
   5 quiz questions at the end with a check answers feature.
============================================= */
function getModulesFor(courseTitle) {
  return [
    {
      title: "Module 1: Introduction & Overview",
      content: `<h3>Welcome to ${courseTitle}</h3>
      <p>This foundational module introduces the key concepts, terminology, and real-world context essential to understanding ${courseTitle}. You will explore the fundamental principles, industry standards, and best practices that form the backbone of this discipline.</p>
      
      <h4>Key Learning Objectives:</h4>
      <ul>
        <li>Understand the core definitions and terminology used in ${courseTitle}</li>
        <li>Learn the historical context and evolution of this field</li>
        <li>Identify key industry standards and regulatory requirements</li>
        <li>Explore career opportunities and professional pathways</li>
        <li>Establish a foundation for advanced learning in subsequent modules</li>
      </ul>
      
      <h4>What You'll Learn:</h4>
      <p>In this module, we will cover the essential background knowledge you need. You'll discover why this subject matters in today's professional landscape, how it integrates with other business functions, and what role you'll play in your organization. Real-world examples and case studies will illustrate how these concepts apply in practice.</p>
      
      <h4>Specific Skills & Knowledge You'll Gain:</h4>
      <ul>
        <li>Master essential terminology and industry-specific vocabulary used by professionals</li>
        <li>Understand the historical development and evolution of the field</li>
        <li>Recognize key stakeholders and their roles in the industry</li>
        <li>Identify major trends and opportunities in the market</li>
        <li>Comprehend basic processes and workflows in this domain</li>
        <li>Discover educational paths and career progression opportunities</li>
        <li>Learn fundamental business drivers and success metrics</li>
        <li>Understand the value proposition and impact on organizations</li>
      </ul>
      
      <p>This module sets the stage for deeper exploration. By the end, you should be able to articulate the core principles, understand key terminology, and see how everything connects to create a cohesive framework for success.</p>`,
      quiz: [
        { q: "What is the primary purpose of studying ${courseTitle}?", options: ["A) To pass time", "B) To develop professional competency and excel in your role", "C) To memorize facts", "D) None of the above"], answer: 1 },
        { q: "Which of the following is a key industry standard mentioned in this module?", options: ["A) Personal preferences only", "B) Established regulatory requirements and best practices", "C) Random guidelines", "D) Optional recommendations"], answer: 1 },
        { q: "What does terminology refer to in the context of this course?", options: ["A) Random words", "B) The specialized language and key terms used in this field", "C) Only technical jargon", "D) Words to ignore"], answer: 1 },
        { q: "How does this module prepare you for advanced learning?", options: ["A) It doesn't", "B) By establishing foundational knowledge and key concepts", "C) By testing your memory", "D) By providing all answers"], answer: 1 },
        { q: "What real-world application will this knowledge have in your career?", options: ["A) Limited use", "B) Direct application in professional roles and decision-making", "C) Theoretical only", "D) No practical use"], answer: 1 }
      ]
    },
    {
      title: "Module 2: Core Principles & Best Practices",
      content: `<h3>Core Principles of ${courseTitle}</h3>
      <p>This module dives deep into the fundamental principles and best practices that guide ${courseTitle}. Understanding these principles is crucial for making sound decisions and achieving professional excellence in your role.</p>
      
      <h4>Fundamental Principles:</h4>
      <ul>
        <li><strong>Principle 1: Quality & Excellence</strong> - Maintaining high standards in all activities and deliverables</li>
        <li><strong>Principle 2: Integrity & Ethics</strong> - Acting with honesty, transparency, and moral responsibility</li>
        <li><strong>Principle 3: Customer-Centricity</strong> - Prioritizing customer/stakeholder needs and satisfaction</li>
        <li><strong>Principle 4: Continuous Improvement</strong> - Regularly evaluating and enhancing processes and outcomes</li>
        <li><strong>Principle 5: Collaboration & Communication</strong> - Working effectively with others through clear communication</li>
      </ul>
      
      <h4>Best Practices Framework:</h4>
      <p>Professional best practices emerge from decades of industry experience. They represent proven methods that consistently deliver superior results. In ${courseTitle}, these practices are organized around key operational areas: planning, execution, monitoring, and optimization.</p>
      
      <h4>What You'll Learn:</h4>
      <ul>
        <li>Apply the five core principles to daily professional activities and decision-making</li>
        <li>Distinguish between effective and ineffective approaches in common scenarios</li>
        <li>Develop a personal code of professional conduct based on industry ethics</li>
        <li>Implement quality assurance methods and performance standards</li>
        <li>Create systems for continuous feedback and ongoing improvement</li>
        <li>Strengthen interpersonal and communication skills for better collaboration</li>
        <li>Build customer-focused mindsets and practices in your work</li>
        <li>Evaluate and adopt best practices relevant to your role and organization</li>
        <li>Recognize when principles are being compromised and take corrective action</li>
        <li>Mentor others on best practices and professional standards</li>
      </ul>
      
      <p>By adhering to these principles and practices, professionals can minimize risks, maximize efficiency, and build strong relationships with colleagues and stakeholders. Success in your field depends on internalizing these values and applying them consistently in your daily work.</p>`,
      quiz: [
        { q: "Which principle emphasizes meeting stakeholder requirements?", options: ["A) Integrity & Ethics", "B) Customer-Centricity", "C) Quality & Excellence", "D) Collaboration"], answer: 1 },
        { q: "What is the purpose of following best practices in ${courseTitle}?", options: ["A) To follow rules blindly", "B) To deliver consistent, superior results and minimize risks", "C) To complicate work", "D) To save time only"], answer: 1 },
        { q: "How do best practices typically develop?", options: ["A) Randomly", "B) From decades of industry experience and proven methods", "C) From individual preferences", "D) From theoretical models only"], answer: 1 },
        { q: "Why is continuous improvement important in this field?", options: ["A) It's not important", "B) To keep up with industry evolution and enhance effectiveness", "C) To confuse competitors", "D) To reduce accountability"], answer: 1 },
        { q: "What role does communication play in professional success?", options: ["A) No role", "B) Limited role", "C) Essential for effective collaboration and achieving goals", "D) Only for management"], answer: 2 }
      ]
    },
    {
      title: "Module 3: Practical Application & Case Studies",
      content: `<h3>Applying ${courseTitle} in Real-World Scenarios</h3>
      <p>Theory becomes valuable only when applied effectively. This module transitions from concepts to practice, showing you how to implement ${courseTitle} principles in actual work situations.</p>
      
      <h4>Practical Applications:</h4>
      <ul>
        <li>Scenario 1: Managing typical workplace situations using core principles</li>
        <li>Scenario 2: Solving problems with proven methodologies</li>
        <li>Scenario 3: Adapting practices to unique organizational contexts</li>
        <li>Scenario 4: Handling challenges and obstacles effectively</li>
        <li>Scenario 5: Measuring success and demonstrating value</li>
      </ul>
      
      <h4>Case Study Analysis:</h4>
      <p>Real organizations have successfully implemented ${courseTitle} practices to achieve remarkable results. By studying these case studies, you'll see:</p>
      <ul>
        <li>How companies identified problems or opportunities</li>
        <li>Which strategies and tactics they employed</li>
        <li>What results and outcomes they achieved</li>
        <li>What lessons can be applied to your own work</li>
      </ul>
      
      <h4>What You'll Learn:</h4>
      <ul>
        <li>Translate theoretical concepts into practical, actionable steps</li>
        <li>Analyze business problems and develop solution strategies</li>
        <li>Customize best practices to fit your organization's unique needs</li>
        <li>Implement solutions effectively while managing risks and resistance</li>
        <li>Create measurable success metrics and track progress</li>
        <li>Document lessons learned and build organizational knowledge</li>
        <li>Present findings and recommendations to stakeholders</li>
        <li>Adapt strategies based on feedback and changing circumstances</li>
        <li>Leverage technology and tools to enhance practical implementation</li>
        <li>Build business cases and demonstrate ROI for initiatives</li>
      </ul>
      
      <p>These practical examples demonstrate that the concepts you're learning aren't theoretical — they work in real business environments. As you progress in your career, you'll face situations similar to these cases. This module prepares you to recognize them and apply appropriate solutions.</p>`,
      quiz: [
        { q: "What is the primary benefit of studying case studies?", options: ["A) Entertainment", "B) Learning from real situations and proven solutions", "C) Memorizing facts", "D) Avoiding work"], answer: 1 },
        { q: "How should theory be applied in practice?", options: ["A) Never", "B) With rigid rules only", "C) Adapted thoughtfully to specific contexts and situations", "D) Only by senior management"], answer: 2 },
        { q: "Which element is NOT typically part of a practical application scenario?", options: ["A) Problem identification", "B) Solution implementation", "C) Random guessing", "D) Results measurement"], answer: 2 },
        { q: "Why are real organizational examples important?", options: ["A) They're not", "B) They demonstrate feasibility and provide actionable insights", "C) To confuse learners", "D) To discourage innovation"], answer: 1 },
        { q: "How do you adapt case study lessons to your own work?", options: ["A) Copy everything exactly", "B) Ignore them completely", "C) Analyze context and adapt relevant principles to your situation", "D) Only follow if management orders it"], answer: 2 }
      ]
    },
    {
      title: "Module 4: Standards, Compliance & Best Practices",
      content: `<h3>Industry Standards & Regulatory Requirements in ${courseTitle}</h3>
      <p>Every professional field operates within a framework of standards, regulations, and compliance requirements. Understanding and adhering to these is not optional — it's essential for professional credibility and legal compliance.</p>
      
      <h4>Key Standards & Regulations:</h4>
      <ul>
        <li><strong>Regulatory Compliance</strong> - Government regulations and legal requirements specific to your industry</li>
        <li><strong>Industry Standards</strong> - Established norms and benchmarks that define quality and professionalism</li>
        <li><strong>Ethical Guidelines</strong> - Code of conduct and ethical principles for professional behavior</li>
        <li><strong>Safety & Risk Management</strong> - Protocols to protect people, data, and organizational assets</li>
        <li><strong>Documentation & Record-Keeping</strong> - Proper procedures for maintaining records and evidence of compliance</li>
      </ul>
      
      <h4>Compliance Best Practices:</h4>
      <p>Compliance isn't something to resent — it's a foundation for trust and excellence. Organizations that maintain high compliance standards:</p>
      <ul>
        <li>Build stronger reputation and client confidence</li>
        <li>Reduce legal and financial risks</li>
        <li>Create safer, more professional work environments</li>
        <li>Establish consistent operational procedures</li>
        <li>Enable better decision-making and accountability</li>
      </ul>
      
      <h4>What You'll Learn:</h4>
      <ul>
        <li>Identify applicable regulations, standards, and policies in your industry</li>
        <li>Interpret compliance requirements and their implications for daily work</li>
        <li>Create and maintain proper documentation and records</li>
        <li>Develop compliance checklists and audit procedures</li>
        <li>Recognize risks and implement preventive controls</li>
        <li>Train team members on compliance standards and expectations</li>
        <li>Respond appropriately to compliance violations or gaps</li>
        <li>Build compliance into workflows and processes proactively</li>
        <li>Communicate compliance standards to stakeholders</li>
        <li>Stay updated on regulatory changes affecting your field</li>
      </ul>
      
      <p>Throughout your career, you'll encounter situations where standards and regulations apply. This module ensures you understand not just the "what" of compliance, but the "why" — so you become an advocate for best practices in your organization.</p>`,
      quiz: [
        { q: "Why are industry standards important in ${courseTitle}?", options: ["A) They're restrictive", "B) They define quality benchmarks and professional norms", "C) They don't matter", "D) Only for large companies"], answer: 1 },
        { q: "What is the primary purpose of compliance regulations?", options: ["A) To make work harder", "B) To protect people, assets, and organizational integrity", "C) To waste time", "D) To favor certain companies"], answer: 1 },
        { q: "How should you respond when regulations seem inconvenient?", options: ["A) Ignore them", "B) Follow them reluctantly", "C) Understand their purpose and follow as best practice", "D) Complain to management"], answer: 2 },
        { q: "What benefit does proper documentation provide?", options: ["A) No benefit", "B) Creates busywork", "C) Evidence of compliance, accountability, and professional standards", "D) Only for audits"], answer: 2 },
        { q: "How do high compliance standards affect organizational culture?", options: ["A) Negatively", "B) Builds trust, safety, and professional excellence", "C) No effect", "D) Only matters to executives"], answer: 1 }
      ]
    },
    {
      title: "Module 5: Advanced Concepts & Professional Development",
      content: `<h3>Advanced Topics & Continuing Professional Growth in ${courseTitle}</h3>
      <p>As you master the fundamentals of ${courseTitle}, it's time to explore advanced concepts that will set you apart as a true professional. This module also addresses your long-term career development and continuous learning.</p>
      
      <h4>Advanced Concepts:</h4>
      <ul>
        <li><strong>Strategic Thinking</strong> - Moving beyond day-to-day operations to long-term planning</li>
        <li><strong>Leadership & Influence</strong> - Leading teams and driving organizational change</li>
        <li><strong>Data Analytics & Decision-Making</strong> - Using data to inform better decisions</li>
        <li><strong>Innovation & Problem-Solving</strong> - Developing creative solutions to complex challenges</li>
        <li><strong>Professional Networking & Mentorship</strong> - Building relationships and supporting others' growth</li>
      </ul>
      
      <h4>Continuing Professional Development:</h4>
      <p>Your learning doesn't end with this certification. The best professionals understand that:</p>
      <ul>
        <li>Industries constantly evolve with new technologies and methods</li>
        <li>Staying current requires ongoing education and skill development</li>
        <li>Mentorship and peer learning accelerate professional growth</li>
        <li>Advanced certifications open new career opportunities</li>
        <li>Contributing to your field benefits everyone</li>
      </ul>
      
      <h4>What You'll Learn:</h4>
      <ul>
        <li>Develop strategic vision and long-term planning capabilities</li>
        <li>Lead teams effectively and influence organizational decisions</li>
        <li>Use data analysis to drive insights and business intelligence</li>
        <li>Cultivate creative thinking and innovative problem-solving skills</li>
        <li>Navigate complex, ambiguous business challenges with confidence</li>
        <li>Build and leverage professional networks for career growth</li>
        <li>Mentor junior colleagues and contribute to organizational learning</li>
        <li>Identify and pursue advanced certifications and specializations</li>
        <li>Stay informed about industry trends and emerging technologies</li>
        <li>Design your personal development plan for long-term career success</li>
        <li>Contribute thought leadership and expertise to your field</li>
        <li>Balance career advancement with personal fulfillment and values</li>
      </ul>
      
      <h4>Your Path Forward:</h4>
      <p>By completing this course, you've demonstrated commitment to professional excellence. The principles, practices, and knowledge you've gained form the foundation for a rewarding career in ${courseTitle}. Continue to learn, stay curious, challenge yourself, and help others grow. This is how industries advance and professionals thrive.</p>`,
      quiz: [
        { q: "What distinguishes advanced professionals from entry-level practitioners?", options: ["A) Years employed only", "B) Strategic thinking and continuous learning approach", "C) Job title alone", "D) Personal preferences"], answer: 1 },
        { q: "Why is continuous professional development important?", options: ["A) It's not", "B) Industries and technologies constantly evolve, requiring ongoing learning", "C) Only if you want management positions", "D) Only required by law"], answer: 1 },
        { q: "How can you stay current in your field?", options: ["A) Stop learning after certification", "B) Only attend annual conferences", "C) Pursue ongoing education, networking, and advanced certifications", "D) Hope things don't change"], answer: 2 },
        { q: "What role does mentorship play in professional growth?", options: ["A) No role", "B) Only for struggling professionals", "C) Critical for accelerated learning and career development", "D) Only for new hires"], answer: 2 },
        { q: "How should you approach your career progression?", options: ["A) Wait for promotions", "B) Actively invest in learning, build relationships, and seek challenges", "C) Only do what's required", "D) Focus only on salary"], answer: 1 }
      ]
    }
  ];
}

/* =============================================
   Generic placeholder exam bank — 20 multiple
   choice questions per course. Replace the
   "questions" array contents with your real exam
   questions later; keep the same shape:
   { q: "...", options: ["A","B","C","D"], answer: 0 }
   (answer = index of the correct option)
============================================= */
function getExamFor(courseTitle) {
  const questions = [];
  for (let i = 1; i <= 20; i++) {
    questions.push({
      q: `Sample question ${i} for "${courseTitle}". Replace this with a real exam question.`,
      options: [
        "Replace with correct answer",
        "Replace with distractor option B",
        "Replace with distractor option C",
        "Replace with distractor option D"
      ],
      correct: 0
    });
  }
  return questions;
}

const normalizeCertificateCode = (code) => {
  return (code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = (event) => reject(new Error(`Failed to load image: ${src}`));
  img.src = src;
});

const drawWrappedText = (ctx, text, x, y, maxWidth, lineHeight) => {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  lines.forEach((lineText, index) => {
    ctx.fillText(lineText, x, y + index * lineHeight);
  });
};

const generateCertificateOverlayImage = async (record) => {
  const image = await loadImage("cert.png");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create canvas context");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const nameText = record.name || "Recipient Name";
  const courseText = record.course ? `has successfully completed ${record.course}` : "has successfully completed the program";
  ctx.fillStyle = "#0f1e43";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const nameFontSize = Math.max(44, Math.floor(canvas.width * 0.05));
  ctx.font = `700 ${nameFontSize}px Montserrat, Arial, sans-serif`;
  const nameY = canvas.height * 0.53;
  drawWrappedText(ctx, nameText, canvas.width / 2, nameY, canvas.width * 0.78, nameFontSize * 1.1);
  const courseFontSize = Math.max(22, Math.floor(canvas.width * 0.024));
  ctx.font = `600 ${courseFontSize}px Montserrat, Arial, sans-serif`;
  drawWrappedText(ctx, courseText, canvas.width / 2, nameY + nameFontSize * 1.9, canvas.width * 0.82, courseFontSize * 1.2);
  return canvas.toDataURL("image/png");
};

const generateCertificateImageFromGemini = async (record) => {
  if (!GEMINI_IMAGE_API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }
  const nameText = record.name || "Recipient Name";
  const courseText = record.course ? `has successfully completed ${record.course}` : "has successfully completed the program";
  const prompt = `Edit this certificate template so the recipient name reads \"${nameText}\" and the course line reads \"${courseText}\" while keeping the original design, colors, borders, and layout exactly the same.`;
  const templateResponse = await fetch("cert.png");
  if (!templateResponse.ok) {
    throw new Error("Unable to load certificate template for Gemini image edit.");
  }
  const templateBlob = await templateResponse.blob();
  const formData = new FormData();
  formData.append("model", GEMINI_IMAGE_MODEL);
  formData.append("prompt", prompt);
  formData.append("size", "1024x768");
  formData.append("response_format", "b64_json");
  formData.append("image[]", templateBlob, "cert.png");
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GEMINI_IMAGE_API_KEY}`
    },
    body: formData
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini image edit failed: ${response.status} ${errorText}`);
  }
  const result = await response.json();
  const b64 = result?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Gemini image edit returned no image data.");
  }
  return `data:image/png;base64,${b64}`;
};

const getCertificateImageUrl = async (record) => {
  try {
    return await generateCertificateImageFromGemini(record);
  } catch (error) {
    console.warn("Gemini certificate image generation failed, using local overlay fallback.", error);
    return await generateCertificateOverlayImage(record);
  }
};

/* =============================================
   Firestore-backed certificates (replaces old
   localStorage "bhf_certificate_records"). Certificates
   now live in the cloud so a certificate issued on one
   device can be verified from any device, by anyone.
============================================= */
// Same-browser UX cache of the last known certificate list — mirrors
// COURSES_SNAPSHOT_KEY/CATEGORIES_SNAPSHOT_KEY. Without this,
// certificatesCache always started as an empty array on every page
// load/reload, so the Dashboard's "await window.dataReadyPromise" (which
// waits on watchCertificates()) had to sit through a full Firestore round
// trip before it could paint achievements/certificates/stats — that round
// trip was the reported delay before data is displayed on initial load and
// every refresh. Seeding synchronously from this snapshot means the very
// first render already has the last known-good certificate list, and
// watchCertificates() below corrects/updates it the moment Firestore
// responds, with no visible delay or reload required.
const CERTIFICATES_SNAPSHOT_KEY = "bhf_certificates_snapshot";

const getCertificatesSnapshot = () => {
  try {
    const raw = rawGetStorage(CERTIFICATES_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveCertificatesSnapshot = (certificates) => {
  try {
    rawSetStorage(CERTIFICATES_SNAPSHOT_KEY, JSON.stringify(certificates || []));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

// Seeded immediately (before any Firestore call has a chance to resolve)
// so the first render on this page load already reflects the last known
// certificate list instead of an empty one.
let certificatesCache = getCertificatesSnapshot();
let resolveCertificatesReady;
const certificatesReadyPromise = new Promise((resolve) => {
  resolveCertificatesReady = resolve;
});

const loadCertificatesCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, "certificates"));
    certificatesCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    saveCertificatesSnapshot(certificatesCache);
  } catch (error) {
    console.error("Failed to load certificates from Firestore", error);
    certificatesCache = [];
  } finally {
    resolveCertificatesReady();
  }
};

let certificatesUnsubscribe = null;
// Start a realtime listener for certificates. Resolves after the first
// snapshot so callers can await the initial data load. The listener keeps
// `certificatesCache` up to date and dispatches a DOM event when updates arrive.
const watchCertificates = () => {
  return new Promise((resolve, reject) => {
    try {
      if (certificatesUnsubscribe) {
        // already watching
        resolve();
        return;
      }
      certificatesUnsubscribe = onSnapshot(collection(db, 'certificates'), (snapshot) => {
        certificatesCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        saveCertificatesSnapshot(certificatesCache);
        // signal other parts of the UI a change occurred
        try { document.dispatchEvent(new CustomEvent('certificates:updated')); } catch (e) {}
        resolve();
        try { resolveCertificatesReady(); } catch (e) {}
      }, (err) => {
        console.warn('watchCertificates error', err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Synchronous read from the in-memory cache — used by pages (dashboard,
// course player) that already have the certificate list loaded at bootstrap.
const getCertificates = () => certificatesCache;

const findCertificateRecord = (code) => {
  const normalized = normalizeCertificateCode(code);
  return certificatesCache.find((cert) => cert.code === normalized) || null;
};

const findUserCertificate = (email, course) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  return certificatesCache.find((cert) => cert.email.toLowerCase() === normalizedEmail && cert.course === course) || null;
};

const getUserCertificates = (email) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  return certificatesCache.filter((cert) => cert.email.toLowerCase() === normalizedEmail);
};

const generateCertificateCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let i = 0; i < 13; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BHF${randomPart}`;
};

// Writes the certificate to Firestore so it's visible from any device,
// then refreshes the local cache and returns the saved record.
const createCertificateFor = async ({
  name,
  course,
  email,
  score,
  total,
  validityDays = 365,
  status = "pending-upload",
  certificateFileUrl = "",
  certificateFileName = "",
  uploadedBy = ""
}) => {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const issuedAt = new Date();
  const expiryDate = new Date(issuedAt);
  expiryDate.setDate(expiryDate.getDate() + Number(validityDays || 365));
  const expiryLabel = expiryDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const code = generateCertificateCode();
  const certificate = {
    code,
    name,
    course,
    email: (email || "").trim().toLowerCase(),
    score,
    total,
    date,
    expiryDate: expiryLabel,
    expiresAt: expiryDate.toISOString(),
    valid: true,
    issuedAt: issuedAt.toISOString(),
    status,
    certificateFileUrl,
    certificateFileName,
    uploadedAt: status === "uploaded" ? issuedAt.toISOString() : null,
    uploadedBy
  };
  await addDoc(collection(db, "certificates"), certificate);
  await loadCertificatesCache();
  createNotification("certificate", `${name} has a certificate request for "${course}"`).catch(() => {});
  return findCertificateRecord(code) || certificate;
};

// Live lookup straight from Firestore by code — used by the public "Verify
// Certificate" tool so it always reflects the source of truth (not just
// whatever this browser happened to have cached), regardless of which
// device or browser issued the certificate.
const fetchCertificateByCode = async (code) => {
  const normalized = normalizeCertificateCode(code);
  const q = query(collection(db, "certificates"), where("code", "==", normalized));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
};

const fetchUserCertificate = async (email, course) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail || !course) return null;
  const q = query(collection(db, "certificates"), where("course", "==", course));
  const snapshot = await getDocs(q);
  const records = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((cert) => (cert.email || "").trim().toLowerCase() === normalizedEmail);
  return records.length ? records[0] : null;
};

const getCertificateStatusText = (certificate) => {
  if (!certificate) return "Invalid certificate.";
  return certificate.valid ? "Active" : "Revoked";
};

/* =============================================
   Enrollments — Firestore-backed so the Admin Dashboard can
   see every learner's enrollment from any device (localStorage
   alone only reflects the browser that enrolled). Written
   alongside the existing localStorage record so nothing that
   already reads getEnrollments() needs to change.
============================================= */
// Same-browser UX cache of the last known enrollment list — mirrors
// COURSES_SNAPSHOT_KEY/CERTIFICATES_SNAPSHOT_KEY. enrollmentsCache used to
// always start as an empty array on every page load/reload, and the only
// way to populate it was a one-shot getDocs() awaited inside
// window.dataReadyPromise — which the Dashboard blocks its entire data
// render on. That full Firestore round trip was the "still a delay before
// it is displayed" behavior: course progress/certificates/stats stayed
// blank until the network call finished, on first load AND on every
// refresh. Seeding synchronously from this snapshot means the very first
// render already has the last known-good enrollment list, and the realtime
// listener below (watchEnrollments) corrects/updates it the moment
// Firestore responds — no visible delay, no reload required.
const ENROLLMENTS_SNAPSHOT_KEY = "bhf_enrollments_snapshot";

const getEnrollmentsSnapshot = () => {
  try {
    const raw = rawGetStorage(ENROLLMENTS_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveEnrollmentsSnapshot = (enrollments) => {
  try {
    rawSetStorage(ENROLLMENTS_SNAPSHOT_KEY, JSON.stringify(enrollments || []));
  } catch {
    // Ignore storage issues; this cache is a UX nicety, not critical state.
  }
};

// Seeded immediately (before any Firestore call has a chance to resolve)
// so the first render on this page load already reflects the last known
// enrollment list instead of an empty one.
let enrollmentsCache = getEnrollmentsSnapshot();

let enrollmentsUnsubscribe = null;
// Realtime listener for enrollments (mirrors watchCourses()/watchCertificates()
// above). Resolves after the first snapshot so callers can still `await`
// the initial load via loadEnrollmentsCache()/dataReadyPromise, but keeps
// pushing updates for as long as the page stays open, mirrors every update
// into localStorage (see ENROLLMENTS_SNAPSHOT_KEY) so the *next* page
// load/reload starts from fresh data, and dispatches an "enrollments:updated"
// event so an already-rendered page (e.g. Dashboard) can refresh instantly
// instead of waiting for a reload.
const watchEnrollments = () => {
  return new Promise((resolve) => {
    try {
      if (enrollmentsUnsubscribe) {
        resolve();
        return;
      }
      enrollmentsUnsubscribe = onSnapshot(collection(db, "enrollments"), (snapshot) => {
        enrollmentsCache = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        saveEnrollmentsSnapshot(enrollmentsCache);
        try { document.dispatchEvent(new CustomEvent('enrollments:updated')); } catch (e) {}
        resolve();
      }, (err) => {
        console.error("Failed to load enrollments from Firestore", err);
        // Surface Firestore permission errors to the UI so the admin knows
        // why the dashboard is empty. Common causes: unauthenticated user,
        // or restrictive Firestore rules ('Missing or insufficient permissions').
        if (err && (err.code === 'permission-denied' || /permission/i.test(String(err.message || '')))) {
          // Don't surface a persistent red toast for permission-denied —
          // log to console and set a flag so the admin banner can be shown
          // in the UI if desired, without spamming the user with toasts.
          console.warn('Firestore permission denied when loading enrollments. Admin sign-in or rules change required.', err);
          FIRESTORE_PERMISSION_DENIED = true;
        } else {
          notifyUser('Failed to load enrollments from Firestore. Check console for details.');
        }
        resolve(); // don't block dataReadyPromise forever on a listener error
      });
    } catch (err) {
      console.warn('Failed to start enrollments listener', err);
      resolve();
    }
  });
};

// Kept as the public entry point (existing call sites throughout the file
// call loadEnrollmentsCache() to force a refresh after writes) — it now
// just ensures the realtime listener above is running and returns the
// live cache, instead of doing a separate one-shot fetch every time.
const loadEnrollmentsCache = async () => {
  await watchEnrollments();
  return enrollmentsCache;
};

const getEnrollmentRecords = () => enrollmentsCache;

/* =============================================
   Notifications — lightweight activity feed that powers the
   Admin Dashboard's Notifications panel (new enrollments,
   certificates earned, etc.)
============================================= */
let notificationsCache = [];

const loadNotificationsCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, "notifications"));
    notificationsCache = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch (error) {
    console.error("Failed to load notifications from Firestore", error);
    notificationsCache = [];
  }
  return notificationsCache;
};

const getNotificationRecords = () => notificationsCache;

const createNotification = async (type, message) => {
  try {
    await addDoc(collection(db, "notifications"), {
      type,
      message,
      read: false,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to create notification", error);
  }
};

const markNotificationRead = async (id) => {
  try {
    await updateDoc(doc(db, "notifications", id), { read: true });
  } catch (error) {
    console.error("Failed to mark notification read", error);
  }
};

const markAllNotificationsRead = async () => {
  const unread = notificationsCache.filter((n) => !n.read);
  await Promise.all(unread.map((n) => markNotificationRead(n.id)));
  await loadNotificationsCache();
};

// Writes a Firestore enrollment record (visible to the Admin Dashboard)
// and fires an "enrollment" notification. Safe to call fire-and-forget —
// it never throws, so it can't block the existing localStorage-based
// enrollment flow if Firestore is briefly unavailable.
//
// Idempotent by (email, course): callers (enrollCourse() in programs.html,
// handleEnrollClick() below) invoke this on every "Enroll Now" click
// regardless of whether the student is already enrolled — e.g. navigating
// back to the Programs page and clicking Enroll again. Without this guard
// that creates a brand new enrollment document every time, which is what
// inflated the admin "Total Enrollments" stat far past the real number of
// enrolled students. enrollmentsCache is kept live by watchEnrollments(),
// so this check reflects the current Firestore state, not a stale copy.
const recordEnrollment = async ({ email, name, course, category }) => {
  try {
    const normalizedEmail = (email || "").toLowerCase();
    const alreadyEnrolled = Array.isArray(enrollmentsCache) && enrollmentsCache.some(
      (e) => (e.email || "").toLowerCase() === normalizedEmail && e.course === course
    );
    if (alreadyEnrolled) return;
    await addDoc(collection(db, "enrollments"), {
      email: (email || "").toLowerCase(),
      name: name || (email ? email.split("@")[0] : "Learner"),
      course,
      category: category || "General",
      status: "in-progress",
      enrolledAt: new Date().toISOString(),
      // Payment flags for admin-managed (FTF) or online purchases
      paid: false,
      paymentMethod: null,
      paidAt: null
    });
    await createNotification("enrollment", `${name || email} enrolled in "${course}"`);
  } catch (error) {
    console.error("Failed to record enrollment in Firestore", error);
  }
};

// Mark an enrollment as paid via face-to-face (FTF) payment and refresh cache
const markEnrollmentFTFPaid = async (enrollmentId, adminEmail) => {
  try {
    await updateDoc(doc(db, "enrollments", enrollmentId), {
      paid: true,
      paymentMethod: 'ftf',
      paidAt: new Date().toISOString(),
      paidBy: adminEmail || (getAuth && getAuth()?.email) || null
    });
    // Refresh local cache so UI and client logic pick up the change
    await loadEnrollmentsCache();
    await createNotification('enrollment-payment', `FTF payment recorded for enrollment ${enrollmentId}`);
    return true;
  } catch (error) {
    console.error('Failed to mark enrollment as FTF paid', error);
    return false;
  }
};

/* =============================================
   Exam schedule — admin-managed upcoming certification exam
   dates. Powers both the "Upcoming Exam" list and the Admin
   Dashboard calendar.
============================================= */
let examScheduleCache = [];

const loadExamScheduleCache = async () => {
  try {
    const snapshot = await getDocs(collection(db, "examSchedule"));
    examScheduleCache = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => new Date(a.examDate || 0) - new Date(b.examDate || 0));
  } catch (error) {
    console.error("Failed to load exam schedule from Firestore", error);
    examScheduleCache = [];
  }
  return examScheduleCache;
};

const getExamSchedule = () => examScheduleCache;

const addExamScheduleEntry = async (entry) => {
  await addDoc(collection(db, "examSchedule"), { ...entry, createdAt: new Date().toISOString() });
  await createNotification("exam", `Exam scheduled for "${entry.course}" on ${entry.examDate}`);
  await loadExamScheduleCache();
};

const removeExamScheduleEntry = async (id) => {
  await deleteDoc(doc(db, "examSchedule", id));
  await loadExamScheduleCache();
};

const getContentOverrides = () => {
  const stored = safeGetStorage(CONTENT_STORE_KEY);
  let local = {};
  try {
    local = stored ? JSON.parse(stored) : {};
  } catch {
    local = {};
  }

  // Merge remote overrides (overridesCache) over local overrides so server
  // stored edits are authoritative across devices.
  const merged = { ...local };
  Object.entries(overridesCache || {}).forEach(([pageKey, selectors]) => {
    merged[pageKey] = merged[pageKey] || {};
    Object.entries(selectors || {}).forEach(([selector, entry]) => {
      merged[pageKey][selector] = { type: entry.type, value: entry.value };
    });
  });
  return merged;
};

const ADMIN_TEXT_TAGS = ["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "A", "LI", "STRONG", "EM"];
const ADMIN_IMAGE_TAGS = ["IMG"];
const BLOCKED_ADMIN_TAGS = ["HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "NAV", "HEADER", "FOOTER", "FORM", "INPUT", "TEXTAREA", "SELECT", "OPTION", "BUTTON", "LABEL"];

// Containers like DIV/LI/A are allowed admin-edit targets so admins can
// retitle a card or teaser blurb. But if a container happens to wrap a real
// data table, a <select>, or other interactive controls (e.g. an admin
// clicks empty padding inside the Issued Certificates panel instead of a
// specific label), `element.textContent` would flatten every row/option
// inside it into one string, and writing that string back with
// `element.textContent = value` permanently destroys the table/controls —
// which is exactly the "wall of unstyled text" bug reported on the
// Certificates admin page. Any container that wraps one of these tags is
// never a valid plain-text edit target, on both the write path (saving a
// new override) and the read path (re-applying an override that was saved
// before this guard existed, so already-corrupted saved overrides stop
// being reapplied instead of needing manual cleanup).
const CONTAINER_UNSAFE_DESCENDANT_SELECTOR = "table, select, input, textarea, button, form, iframe";
const CONTAINER_TAGS_TO_GUARD = ["DIV", "LI", "A"];
const hasUnsafeDescendant = (element) =>
  !!element && CONTAINER_TAGS_TO_GUARD.includes(element.tagName) &&
  !!element.querySelector(CONTAINER_UNSAFE_DESCENDANT_SELECTOR);

const saveContentOverride = async (pageKey, selector, content, type = "text", options = {}) => {
  const overrides = getContentOverrides();
  overrides[pageKey] = overrides[pageKey] || {};
  overrides[pageKey][selector] = { type, value: content };
  safeSetStorage(CONTENT_STORE_KEY, JSON.stringify(overrides));
  if (options.skipRemote) return { synced: false, reason: "skipped" };
  try {
    if (isAdminOrInstructor()) {
      await saveRemoteOverride(pageKey, selector, { type, value: content });
      return { synced: true };
    }
    // Not signed in as admin/instructor: this edit only lives in this
    // browser's local storage. It will NOT show up on other devices/
    // browsers, and will be lost if this browser's storage is cleared.
    return { synced: false, reason: "not-signed-in" };
  } catch (err) {
    console.error('Remote override save failed', err);
    return { synced: false, reason: "error", error: err };
  }
};

const clearContentOverride = (pageKey, selector, options = {}) => {
  const overrides = getContentOverrides();
  if (!overrides[pageKey]) return;
  delete overrides[pageKey][selector];
  if (Object.keys(overrides[pageKey]).length === 0) {
    delete overrides[pageKey];
  }
  safeSetStorage(CONTENT_STORE_KEY, JSON.stringify(overrides));
  if (options.skipRemote) return;
  try {
    if (isAdminOrInstructor()) {
      removeRemoteOverride(pageKey, selector).catch((err) => {
        console.error('Remote override remove failed', err);
      });
    }
  } catch (err) {
    console.error('clearContentOverride remote branch failed', err);
  }
};

const applyContentOverrides = (pageKey) => {
  if (pageKey === "admin") return;
  const overrides = getContentOverrides();
  const globalOverrides = overrides['global'] || {};
  const defaultOverrides = overrides[pageKey] || {};
  // The homepage also picks up overrides saved from the "Verify" section
  // (which lives on this same page) and from Browse Programs, so an
  // instructor's edits to the Programs Overview teaser cards - which the
  // homepage and Browse Programs share - stay in sync between both pages.
  const extraOverrides = pageKey === "home" ? { ...(overrides["verify"] || {}), ...(overrides["programs"] || {}) } : {};
  const pageOverrides = { ...globalOverrides, ...defaultOverrides, ...extraOverrides };

  Object.entries(pageOverrides).forEach(([selector, entry]) => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        if (!element) return;
        if (entry && typeof entry === "object") {
          if (entry.type === "image" && element.tagName === "IMG") {
            element.src = entry.value;
          } else if (entry.type === "text" && ADMIN_TEXT_TAGS.includes(element.tagName)) {
            if (hasUnsafeDescendant(element)) return; // see hasUnsafeDescendant comment above
            element.textContent = entry.value;
          } else if (entry.type === "position") {
            try {
              const pos = JSON.parse(entry.value || "{}");
              const x = Number(pos.x) || 0;
              const y = Number(pos.y) || 0;
              element.style.transform = (x || y) ? `translate(${x}px, ${y}px)` : "";
            } catch (err) {
              console.warn("Invalid position override value", err);
            }
          } else if (entry.type === "size") {
            try {
              const size = JSON.parse(entry.value || "{}");
              if (size.width) element.style.width = `${Number(size.width)}px`;
              if (size.height) element.style.height = `${Number(size.height)}px`;
              if (element.tagName === "IMG") element.style.objectFit = "cover";
            } catch (err) {
              console.warn("Invalid size override value", err);
            }
          }
        }
      });
    } catch (error) {
      console.warn(`Skipped invalid override selector: ${selector}`, error);
    }
  });
};

const isValidImageUrl = (url) => {
  try {
    const parsed = new URL(url, window.location.href);
    return ["http:", "https:", "data:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const isSafeAdminElement = (element) => {
  if (!element) return false;
  const tag = element.tagName;
  if (BLOCKED_ADMIN_TAGS.includes(tag)) return false;
  if (hasUnsafeDescendant(element)) return false;
  return ADMIN_TEXT_TAGS.includes(tag) || ADMIN_IMAGE_TAGS.includes(tag);
};


// Safe HTML escaper used across the app. Defined at module top-level so it
// can be used by any function before later code blocks run.
const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>\"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));


const isAdmin = () => currentUser?.role === "admin" || currentUser?.role === "superadmin";
const isInstructor = () => currentUser?.role === "instructor";
const isAdminOrInstructor = () => isAdmin() || isInstructor();
const getPortalHref = (role) => (role === "superadmin" ? "superadmin.html" : role === "admin" ? "admin.html" : role === "instructor" ? "instructor.html" : "dashboard.html");

// Used specifically right after a login/signup (and when someone revisits
// the login/signup page while already authenticated). Regular users land
// on the public Home page instead of their internal dashboard; admins and
// instructors still go to their own portals since those aren't "profile" pages.
const getPostAuthHref = (role) => (role === "superadmin" ? "superadmin.html" : role === "admin" ? "admin.html" : role === "instructor" ? "instructor.html" : "index.html");

const getAuth = () => currentUser;

// Finds (or creates) the two stable sub-groups inside .nav-links:
// - .nav-main-links holds the page links (Home/Programs/Verify, etc.) and
//   never changes width based on auth state.
// - .nav-account-links holds Login/user-pill/Logout and is pinned to the
//   far right via margin-left:auto, so it can resize freely without
//   shifting the page links next to the logo.
const getNavGroups = (nav) => {
  let mainWrap = nav.querySelector('.nav-main-links');
  let accountWrap = nav.querySelector('.nav-account-links');
  if (!mainWrap) {
    mainWrap = document.createElement('div');
    mainWrap.className = 'nav-main-links';
    nav.insertBefore(mainWrap, nav.firstChild);
  }
  if (!accountWrap) {
    accountWrap = document.createElement('div');
    accountWrap.className = 'nav-account-links';
    nav.appendChild(accountWrap);
  }
  return { mainWrap, accountWrap };
};

const createOrUpdateNotificationButton = () => {
  if (page === 'login' || page === 'signup') {
    return null;
  }

  let button = document.getElementById('user-notifications-button');
  if (!button) {
    button = document.createElement('button');
    button.id = 'user-notifications-button';
    button.type = 'button';
    button.className = 'btn btn-secondary btn-notification';
    button.setAttribute('aria-label', 'Notifications');
    button.title = 'Notifications';
    button.textContent = '🔔';
  } else {
    button.setAttribute('aria-label', 'Notifications');
    button.title = 'Notifications';
  }
  return button;
};

// Builds the avatar + name + chevron trigger and its click-to-open dropdown
// menu (My Profile / Certificates / Learning History / Logout)
// for a signed-in user, or a simple "Login" link when signed out. Shared by
// both the admin and public topbar renderers so the two never drift apart.
const renderHeaderAccountArea = (accountWrap) => {
  if (!accountWrap) return;

  const auth = getAuth();
  const logoutLink = document.getElementById('logout-button');
  const themeToggle = document.getElementById('bhf-theme-toggle');
  const notificationButton = createOrUpdateNotificationButton();

  accountWrap.innerHTML = '';

  if (notificationButton) {
    if (auth) {
      // Only show the notifications bell to signed-in users. Clear any
      // display:none set in the static HTML (used to avoid a flash of
      // the bell for logged-out visitors before this script runs).
      notificationButton.style.display = '';
      accountWrap.appendChild(notificationButton);
    } else if (notificationButton.parentNode) {
      notificationButton.parentNode.removeChild(notificationButton);
    }
  }

  if (themeToggle) {
    themeToggle.classList.remove('fixed');
    themeToggle.setAttribute('aria-label', 'Toggle dark mode');
    themeToggle.title = themeToggle.textContent || 'Toggle dark mode';
    themeToggle.style.width = '';
    themeToggle.style.height = '';
    accountWrap.appendChild(themeToggle);
  }

  if (!auth) {
    const authLink = document.createElement('a');
    authLink.id = 'nav-auth-link';
    authLink.className = 'login-link';
    authLink.href = 'login.html';
    authLink.textContent = 'Login';
    accountWrap.appendChild(authLink);
  } else {
    const portalHref = getPortalHref(auth.role);
    const fullName = (auth.name && auth.name.trim()) || (auth.email ? auth.email.split('@')[0] : 'User');
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'User';
    const initials = nameParts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
    const photoUrl = auth.photoURL || getStoredProfilePhoto(auth.uid) || null;
    const avatarStyle = photoUrl
      ? `background-image:url('${photoUrl}');background-size:cover;background-position:center;color:transparent;`
      : '';

    const wrap = document.createElement('div');
    wrap.className = 'nav-user';
    wrap.id = 'nav-user-menu';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'nav-user-trigger';
    trigger.id = 'nav-user-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `
      <span class="nav-user-avatar" style="${avatarStyle}">${photoUrl ? '' : initials}</span>
      <span class="nav-user-name">${escapeHtml(firstName)}</span>
      <span class="nav-user-chevron" aria-hidden="true">⌄</span>
    `;

    const isStaff = auth.role === 'admin' || auth.role === 'instructor';
    const menuLinksTopHtml = isStaff
      ? `<a href="${portalHref}" role="menuitem">${auth.role === 'admin' ? 'Admin Panel' : 'Instructor Panel'}</a>`
      : `
        <a href="${portalHref}#profile-panel" role="menuitem">My Profile</a>
        <a href="${portalHref}#achievements-panel" role="menuitem">Certificates</a>
      `;
    const menuLinksBottomHtml = isStaff
      ? ''
      : `<a href="${portalHref}#learning-history-panel" role="menuitem">Learning History</a>`;

    const dropdown = document.createElement('div');
    dropdown.className = 'nav-user-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.innerHTML = `
      <div class="nav-user-dropdown-header">
        <span class="nav-user-avatar" style="${avatarStyle}">${photoUrl ? '' : initials}</span>
        <span class="nav-user-dropdown-name">${escapeHtml(fullName)}</span>
      </div>
      <div class="nav-user-dropdown-divider"></div>
      ${menuLinksTopHtml}
    `;

    if (menuLinksBottomHtml) {
      const bottomWrap = document.createElement('div');
      bottomWrap.innerHTML = menuLinksBottomHtml;
      while (bottomWrap.firstChild) {
        dropdown.appendChild(bottomWrap.firstChild);
      }
    }

    const logoutItem = logoutLink || document.createElement('a');
    logoutItem.id = 'logout-button';
    if (!logoutItem.getAttribute('href')) logoutItem.href = 'login.html';
    logoutItem.textContent = 'Logout';
    logoutItem.setAttribute('role', 'menuitem');
    logoutItem.className = 'nav-user-logout';
    logoutItem.style.display = 'flex';
    dropdown.appendChild(logoutItem);

    wrap.appendChild(trigger);
    wrap.appendChild(dropdown);
    accountWrap.appendChild(wrap);
  }

  bindLogoutButtons();
};

const renderAdminHeaderNav = () => {
  const nav = document.querySelector(".nav-links");
  if (!nav) return;

  const navLinks = [
    { href: "index.html", text: "Home" },
    { href: "programs.html", text: "Programs" },
    { href: "index.html#verify", text: "Verify" }
  ];

  const { mainWrap, accountWrap } = getNavGroups(nav);

  mainWrap.innerHTML = "";
  navLinks.forEach(({ href, text }) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    mainWrap.appendChild(link);
  });

  renderHeaderAccountArea(accountWrap);
};

const renderPublicHeaderNav = () => {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;

  const navLinks = [
    { href: 'index.html', text: 'Home' },
    { href: 'programs.html', text: 'Programs' },
    { href: 'index.html#verify', text: 'Verify' }
  ];

  const { mainWrap, accountWrap } = getNavGroups(nav);

  mainWrap.innerHTML = '';
  navLinks.forEach(({ href, text }) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    mainWrap.appendChild(link);
  });

  renderHeaderAccountArea(accountWrap);
};

const ensureAdminLink = () => {
  if (isAdminOrInstructor()) {
    renderAdminHeaderNav();
  }
};

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-credential": "Incorrect email or password. Please try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-disabled": "This account has been disabled. Please contact the academy office.",
  "auth/user-not-found": "This email is not registered yet. Please create an account first.",
  "auth/wrong-password": "Incorrect password entered. Please try again.",
  "auth/email-already-in-use": "An account with this email already exists. Please log in instead.",
  "auth/weak-password": "Password must be at least 6 characters long.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network error. Please check your connection and try again."
};

const describeAuthError = (error) => AUTH_ERROR_MESSAGES[error?.code] || "Something went wrong. Please try again.";

window.handleLogin = async (event) => {
  event.preventDefault();
  const note = document.getElementById("login-note");
  const submitButton = event.target?.querySelector('button[type="submit"]');
  const email = document.getElementById("email")?.value.trim().toLowerCase() || "";
  const password = document.getElementById("password")?.value || "";

  const banner = document.getElementById("login-banner");
  clearBannerMessage(banner);
  if (note) {
    note.textContent = "";
    note.className = "form-note";
  }

  if (!validateGmail(email)) {
    const message = "Please enter a valid email address.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (password.length < 6) {
    const message = "Password must be at least 6 characters long.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (submitButton) submitButton.disabled = true;

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const instructorProfile = (email === ADMIN_EMAIL || email === SUPERADMIN_EMAIL) ? null : await getInstructorProfile(credential.user.uid);
    const role = email === SUPERADMIN_EMAIL ? "superadmin" : email === ADMIN_EMAIL ? "admin" : (instructorProfile && instructorProfile.active !== false ? "instructor" : "user");
    const successMessage = "Login successful. Redirecting to your dashboard...";
    setFormNote(note, successMessage, "success");
    setBannerMessage(banner, successMessage, "success");

    // Save the profile snapshot NOW, using the data we already have, so the
    // destination page's optimistic render can show the nav bar profile
    // immediately instead of waiting for onAuthStateChanged to redo these
    // same lookups after the redirect.
    const displayName = credential.user.displayName || instructorProfile?.name || (role === "admin" || role === "superadmin" ? "Admin" : email.split("@")[0]);
    saveLastUserSnapshot({
      uid: credential.user.uid,
      email: credential.user.email,
      name: displayName,
      role,
      photoURL: credential.user.photoURL || getStoredProfilePhoto(credential.user.uid) || null
    });

    window.setTimeout(() => {
      window.location.href = getPostAuthHref(role);
    }, 600);
  } catch (error) {
    const message = describeAuthError(error);
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    notifyUser(message, note);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

const bindLoginForm = () => {
  const form = document.getElementById("login-form");
  if (!form || form.dataset.bound === "true") return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (typeof window.handleLogin === "function") {
      await window.handleLogin(event);
    }
  });

  form.dataset.bound = "true";
};

const initializeAuthPages = () => {
  bindLoginForm();
  bindSignupForm();
  bindForgotPasswordForms();
  bindChangePasswordForm();
};

const bindSignupForm = () => {
  const form = document.getElementById("signup-form");
  if (!form || form.dataset.bound === "true") return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (typeof window.handleSignup === "function") {
      window.handleSignup(event);
    } else {
      const note = document.getElementById("signup-note");
      setFormNote(note, "Registration is temporarily unavailable. Please refresh and try again.");
    }
  });

  form.dataset.bound = "true";
};

const bindLogoutButtons = () => {
  const buttons = document.querySelectorAll('#logout-button, [data-action="logout"], .logout-button');
  buttons.forEach((button) => {
    if (button.dataset.bound === "true") return;

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      await signOut(auth);
      // Clear immediately rather than waiting for onAuthStateChanged to fire,
      // so a logout can never leave a stale cached profile behind (e.g. the
      // nav bar briefly showing the old profile on the login page).
      saveLastUserSnapshot(null);
      window.location.href = "login.html";
    });

    button.dataset.bound = "true";
  });
};

// Click-to-open user menu in the topbar (avatar + name + chevron). Uses a
// single delegated listener on document so it keeps working even though the
// trigger/dropdown markup is rebuilt from scratch on every nav re-render.
const closeAllNavUserMenus = () => {
  document.querySelectorAll(".nav-user.is-open").forEach((el) => {
    el.classList.remove("is-open");
    el.querySelector(".nav-user-trigger")?.setAttribute("aria-expanded", "false");
  });
};

document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".nav-user-trigger");
  if (trigger) {
    const wrap = trigger.closest(".nav-user");
    if (!wrap) return;
    const wasOpen = wrap.classList.contains("is-open");
    closeAllNavUserMenus();
    if (!wasOpen) {
      wrap.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
    }
    return;
  }

  // Clicking a menu item or anywhere outside the dropdown closes it.
  if (!event.target.closest(".nav-user-dropdown")) {
    closeAllNavUserMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllNavUserMenus();
});

// Mobile hamburger menu: toggles the Home/Programs/Verify links as a
// dropdown panel on narrow screens. Notification, theme toggle, and the
// login/profile controls in .nav-account-links stay visible in the header
// row at all times and are untouched by this.
const closeMobileNav = () => {
  document.querySelectorAll(".nav-main-links.is-open").forEach((el) => el.classList.remove("is-open"));
  document.querySelectorAll(".nav-hamburger.is-open").forEach((el) => {
    el.classList.remove("is-open");
    el.setAttribute("aria-expanded", "false");
  });
};

document.addEventListener("click", (event) => {
  const hamburger = event.target.closest(".nav-hamburger");
  if (hamburger) {
    const nav = hamburger.closest("header")?.querySelector(".nav-main-links");
    if (!nav) return;
    const wasOpen = nav.classList.contains("is-open");
    closeMobileNav();
    if (!wasOpen) {
      nav.classList.add("is-open");
      hamburger.classList.add("is-open");
      hamburger.setAttribute("aria-expanded", "true");
    }
    return;
  }

  if (event.target.closest(".nav-main-links a")) {
    closeMobileNav();
    return;
  }

  if (!event.target.closest(".nav-main-links") && !event.target.closest(".nav-hamburger")) {
    closeMobileNav();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileNav();
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 768) closeMobileNav();
});

const setFormNote = (noteElement, message, type = "error") => {
  if (!noteElement) return;
  noteElement.textContent = message;
  noteElement.className = `form-note ${type === "success" ? "success" : "error"}`;
  noteElement.style.color = type === "success" ? "#114b88" : "#b33a3a";
};

const setBannerMessage = (bannerElement, message, type = "error") => {
  if (!bannerElement) return;
  bannerElement.textContent = message || "";
  bannerElement.className = `auth-alert ${message ? type : ""}`.trim();
  bannerElement.style.display = message ? "block" : "none";
  if (message) {
    bannerElement.removeAttribute("hidden");
    bannerElement.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    bannerElement.setAttribute("hidden", "");
  }
};

const clearBannerMessage = (bannerElement) => {
  if (!bannerElement) return;
  bannerElement.textContent = "";
  bannerElement.className = "auth-alert";
  bannerElement.style.display = "none";
  bannerElement.setAttribute("hidden", "");
};

const validateGmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  // Accept any valid email format or admin email
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  return emailRegex.test(normalized);
};

const validatePasswordStrength = (password) => {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required." };
  }
  if (password.length < 6) {
    return { valid: false, message: "Password must be at least 6 characters long." };
  }
  if (/\s/.test(password)) {
    return { valid: false, message: "Password cannot contain spaces." };
  }
  return { valid: true };
};

const bindForgotPasswordForms = () => {
  const emailForm = document.getElementById("reset-email-form");
  const emailNote = document.getElementById("reset-email-note");
  const codeForm = document.getElementById("reset-code-form");
  const codeNote = document.getElementById("reset-code-note");

  if (emailForm && emailForm.dataset.bound !== "true") {
    emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!emailNote) return;
      emailNote.textContent = "";
      const email = document.getElementById("reset-email")?.value.trim().toLowerCase() || "";
      const submitButton = emailForm.querySelector('button[type="submit"]');
      if (!validateGmail(email)) {
        setFormNote(emailNote, "Enter a valid email address.", "error");
        return;
      }
      if (submitButton) submitButton.disabled = true;
      try {
        await sendPasswordResetEmail(auth, email);
        setFormNote(emailNote,
          "A password reset email has been sent. Open it and copy the verification code from the reset link, then paste it below.",
          "success"
        );
      } catch (error) {
        const message = describeAuthError(error);
        setFormNote(emailNote, message, "error");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
    emailForm.dataset.bound = "true";
  }

  if (codeForm && codeForm.dataset.bound !== "true") {
    codeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!codeNote) return;
      codeNote.textContent = "";
      const code = document.getElementById("reset-code")?.value.trim() || "";
      const newPassword = document.getElementById("reset-new-password")?.value || "";
      const confirmPassword = document.getElementById("reset-confirm-password")?.value || "";
      const submitButton = codeForm.querySelector('button[type="submit"]');

      if (!code) {
        setFormNote(codeNote, "Enter the verification code from your reset email.", "error");
        return;
      }
      if (newPassword !== confirmPassword) {
        setFormNote(codeNote, "The new passwords do not match.", "error");
        return;
      }
      const passwordCheck = validatePasswordStrength(newPassword);
      if (!passwordCheck.valid) {
        setFormNote(codeNote, passwordCheck.message, "error");
        return;
      }
      if (submitButton) submitButton.disabled = true;

      try {
        const email = await verifyPasswordResetCode(auth, code);
        await confirmPasswordReset(auth, code, newPassword);
        await signInWithEmailAndPassword(auth, email, newPassword);
        setFormNote(codeNote, "Password reset successful. You are now signed in.", "success");
        window.setTimeout(() => {
          window.location.href = "index.html";
        }, 800);
      } catch (error) {
        const message = describePasswordActionError(error);
        setFormNote(codeNote, message, "error");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
    codeForm.dataset.bound = "true";
  }
};

const bindChangePasswordForm = () => {
  const changePasswordForm = document.getElementById("change-password-form");
  const changePasswordNote = document.getElementById("change-password-note");
  if (!changePasswordForm || changePasswordForm.dataset.bound === "true") return;

  changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!changePasswordNote) return;
    changePasswordNote.textContent = "";

    const currentPassword = document.getElementById("current-password")?.value || "";
    const newPassword = document.getElementById("new-password")?.value || "";
    const confirmPassword = document.getElementById("confirm-new-password")?.value || "";
    const submitButton = changePasswordForm.querySelector('button[type="submit"]');

    if (!currentPassword) {
      setFormNote(changePasswordNote, "Enter your current password.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormNote(changePasswordNote, "New passwords do not match.", "error");
      return;
    }
    const passwordCheck = validatePasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      setFormNote(changePasswordNote, passwordCheck.message, "error");
      return;
    }
    if (newPassword === currentPassword) {
      setFormNote(changePasswordNote, "New password must be different from the current password.", "error");
      return;
    }
    if (submitButton) submitButton.disabled = true;

    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        throw new Error("Unable to verify your current session. Please sign in again.");
      }
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      setFormNote(changePasswordNote, "Password changed successfully.", "success");
      changePasswordForm.reset();
    } catch (error) {
      const message = describeAuthError(error);
      setFormNote(changePasswordNote, message, "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  changePasswordForm.dataset.bound = "true";
};

const passwordActionErrorMessages = {
  "auth/expired-action-code": "This verification code has expired. Request a new password reset email.",
  "auth/invalid-action-code": "The verification code is invalid. Please copy the code from the latest reset email.",
  "auth/user-not-found": "No account exists with that email.",
  "auth/wrong-password": "The current password is incorrect.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
};

const describePasswordActionError = (error) => passwordActionErrorMessages[error?.code] || describeAuthError(error);

const ensureToastContainer = () => {
  let wrapper = document.getElementById("bhf-toast-wrapper");
  if (wrapper) return wrapper;
  wrapper = document.createElement("div");
  wrapper.id = "bhf-toast-wrapper";
  wrapper.className = "toast-wrapper";
  document.body.appendChild(wrapper);
  return wrapper;
};

const showToast = (message, type = "info") => {
  const wrapper = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  wrapper.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("toast-hide");
    window.setTimeout(() => toast.remove(), 300);
  }, 4200);
  toast.addEventListener("click", () => toast.remove());
};

const sendBrowserNotification = (title, body) => {
  if (!("Notification" in window)) return false;

  const show = () => {
    try {
      new Notification(title, {
        body,
        requireInteraction: true
      });
      return true;
    } catch (err) {
      console.warn("Notification failed", err);
      return false;
    }
  };

  if (Notification.permission === "granted") {
    return show();
  }

  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        show();
      }
    });
  }

  return false;
};

const notifyUser = (message, noteElement = null) => {
  const sent = sendBrowserNotification("BHF Certification Academy", message);
  showToast(message, "error");
  if (!sent && noteElement) {
    setFormNote(noteElement, message, "error");
  }
};

const requestNotificationPermission = () => {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission();
};

const clearAuth = async () => {
  await signOut(auth);
  // Clear immediately rather than waiting for onAuthStateChanged to fire,
  // so a logout can never leave a stale cached profile behind.
  saveLastUserSnapshot(null);
};

const isAuthenticated = () => {
  return Boolean(getAuth());
};

window.handleLogout = async () => {
  await clearAuth();
  window.location.href = "login.html";
};

/* FIX: the generic handler was matching the hero "Login to Portal" button
   (via .login-link) and overwriting its href BEFORE the home-page-specific
   code below could find it by href="login.html" — so the custom
   "My Dashboard" / "Admin Panel" label never showed. The hero button now
   has its own id (#hero-portal-btn) and is excluded here so the home block
   can fully control its text/href instead. */
const updateHeaderAuthLink = () => {
  const auth = getAuth();
  const loginLinks = Array.from(
    document.querySelectorAll('a.login-link:not(#logout-button):not(#hero-portal-btn):not(#nav-auth-link)')
  );
  const redirectPage = getPortalHref(auth?.role);
  const userLabel = auth && auth.name ? auth.name.split(" ")[0] : auth ? (auth.role === "admin" ? "Admin" : auth.role === "instructor" ? "Instructor" : "Dashboard") : "Login";

  // Other login/portal call-to-action buttons on the page (outside the
  // topbar dropdown, e.g. hero CTAs) still get a plain label + link.
  loginLinks.forEach((link) => {
    if (!auth) {
      link.href = "login.html";
      link.textContent = "Login";
    } else {
      link.href = redirectPage;
      link.textContent = userLabel;
    }
  });

  // Render admin-specific navigation only for admin users; otherwise render
  // the public navigation that does not include Add/Manage course links.
  // Both build the avatar + name + dropdown menu in the topbar via
  // renderHeaderAccountArea().
  if (isAdminOrInstructor()) {
    renderAdminHeaderNav();
  } else {
    renderPublicHeaderNav();
  }
};

window.handleSignup = async (event) => {
  event.preventDefault();
  const note = document.getElementById("signup-note");
  const submitButton = event.target?.querySelector('button[type="submit"]');
  const name = document.getElementById("fullname")?.value.trim() || "";
  const email = document.getElementById("email")?.value.trim().toLowerCase() || "";
  const password = document.getElementById("password")?.value || "";
  const confirm = document.getElementById("confirm-password")?.value || "";

  const banner = document.getElementById("signup-banner");
  clearBannerMessage(banner);
  if (note) {
    note.textContent = "";
    note.className = "form-note";
  }

  if (!name) {
    const message = "Please enter your full name.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (!validateGmail(email)) {
    const message = "Please register with a valid Gmail address ending in @gmail.com.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (email === "admin@bhf.com") {
    const message = "This email is reserved for admin access only. Use a Gmail address to register.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (password.length < 6) {
    const message = "Password must be at least 6 characters long.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (password !== confirm) {
    const message = "Passwords do not match. Please try again.";
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
    return false;
  }

  if (submitButton) submitButton.disabled = true;

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    // Explicitly await the "users" profile write here instead of relying on
    // the fire-and-forget call inside onAuthStateChanged. Without this, the
    // redirect below can navigate away before that write finishes, which
    // silently drops the doc the admin dashboard needs to count this user.
    await syncUserProfile(credential.user, "user", name);

    const successMessage = "Account created successfully. Redirecting to your dashboard...";
    setFormNote(note, successMessage, "success");
    setBannerMessage(banner, successMessage, "success");
    window.setTimeout(() => {
      window.location.href = "index.html";
    }, 800);
  } catch (error) {
    const message = describeAuthError(error);
    setFormNote(note, message, "error");
    setBannerMessage(banner, message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }

  return false;
};

/* =============================================
   Walk-in Registration — Admin feature to register students in person
   Includes: account creation, real email delivery, certificate upload
============================================= */

/* ---------- EmailJS config ----------
   EmailJS (emailjs.com) sends real emails straight from the browser,
   no backend server required. To activate real email delivery:
     1. Create a free account at https://www.emailjs.com
     2. Add an Email Service (Gmail, Outlook, etc.) — copy its Service ID below.
     3. Create an Email Template — copy its Template ID below. The template
        should use these variable names so the data fills in correctly:
        {{to_email}}, {{to_name}}, {{temp_password}}, {{certificate_code}},
        {{login_url}}, {{course}}
     4. Go to Account > General in EmailJS, copy your Public Key below.
   Until real values replace the placeholders, the app safely falls back
   to logging the email + creating an in-app notification instead. */
const EMAILJS_PUBLIC_KEY = "YOUR_EMAILJS_PUBLIC_KEY";
const EMAILJS_SERVICE_ID = "YOUR_EMAILJS_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_EMAILJS_TEMPLATE_ID";

const isEmailjsConfigured = () =>
  EMAILJS_PUBLIC_KEY && EMAILJS_PUBLIC_KEY !== "YOUR_EMAILJS_PUBLIC_KEY" &&
  EMAILJS_SERVICE_ID && EMAILJS_SERVICE_ID !== "YOUR_EMAILJS_SERVICE_ID" &&
  EMAILJS_TEMPLATE_ID && EMAILJS_TEMPLATE_ID !== "YOUR_EMAILJS_TEMPLATE_ID" &&
  typeof window !== "undefined" && !!window.emailjs;

const generateTemporaryPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const createWalkinStudent = async ({
  firstName,
  lastName,
  email,
  phone = '',
  enrollmentCourse = '',
  notes = '',
  sendEmail = true,
  certificateFile = null // optional: { dataUrl, fileName } — attach the certificate right away instead of uploading it later
}) => {
  try {
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const tempPassword = generateTemporaryPassword();
    const normalizedEmail = email.trim().toLowerCase();
    const certificateCode = generateCertificateCode();
    
    // Step 1: Create Firebase Auth account with temporary password
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, tempPassword);
    const uid = userCredential.user.uid;
    
    // Step 2: Update Firebase profile
    await updateProfile(userCredential.user, {
      displayName: fullName
    });
    
    // Step 3: Create user profile in Firestore
    await setDoc(doc(db, "users", normalizedEmail), {
      uid,
      name: fullName,
      email: normalizedEmail,
      phone,
      role: "user",
      createdAt: new Date().toISOString(),
      registrationType: "walk-in",
      registeredBy: currentUser?.email || "admin@bhf.com",
      notes,
      isWalkinStudent: true
    });
    
    // Step 4: If course is specified, create enrollment
    if (enrollmentCourse && enrollmentCourse.trim()) {
      await addDoc(collection(db, "enrollments"), {
        name: fullName,
        email: normalizedEmail,
        course: enrollmentCourse.trim(),
        status: "in-progress",
        enrolledAt: new Date().toISOString(),
        enrollmentType: "walk-in"
      });
    }
    
    // Step 5: Create certificate record. If the admin attached a
    // certificate file during registration, mark it uploaded immediately
    // instead of leaving it as "pending-upload" for a separate step later.
    const hasCertificateFile = !!(certificateFile && certificateFile.dataUrl);
    const certificateRecord = {
      code: certificateCode,
      name: fullName,
      course: enrollmentCourse || "General",
      email: normalizedEmail,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      issuedAt: new Date().toISOString(),
      status: hasCertificateFile ? "uploaded" : "pending-upload",
      certificateFileUrl: hasCertificateFile ? certificateFile.dataUrl : "",
      certificateFileName: hasCertificateFile ? (certificateFile.fileName || "") : "",
      uploadedAt: hasCertificateFile ? new Date().toISOString() : "",
      uploadedBy: currentUser?.email || "admin@bhf.com",
      valid: true,
      score: 0,
      total: 0,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    };
    
    await addDoc(collection(db, "certificates"), certificateRecord);
    
    // Step 6: Send the account/login email
    let emailSendResult = { attempted: false, sent: false };
    if (sendEmail) {
      const loginUrl = `${location.origin}/login.html`;
      const emailHtml = `
          <h2>Welcome to BHF Certification Academy! 👋</h2>
          <p>Your walk-in student account has been created. Here are your login credentials:</p>
          
          <div style="background: #f5f5f5; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
            <p><strong>Username/Email:</strong> ${normalizedEmail}</p>
            <p><strong>Temporary Password:</strong> <code style="background: #fff; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">${tempPassword}</code></p>
            <p><strong>Certificate ID:</strong> <code style="background: #fff; padding: 0.2rem 0.5rem; border-radius: 4px; font-family: monospace;">${certificateCode}</code></p>
          </div>
          
          <h3>Next Steps:</h3>
          <ol>
            <li>Visit <a href="${location.origin}">BHF Academy</a></li>
            <li>Click "Login" and enter your credentials above</li>
            <li>Change your password on first login</li>
            <li>Access your enrolled courses and download certificates</li>
          </ol>
          
          <h3>Certificate Information:</h3>
          <p>Your Certificate ID (<strong>${certificateCode}</strong>) can be used to verify your certificate online.</p>
          
          <p>If you have any questions, please contact the BHF Academy support team.</p>
          
          <p>Best regards,<br/>BHF Certification Academy Team</p>
        `;

      if (isEmailjsConfigured()) {
        // Real delivery via EmailJS — no backend server required.
        try {
          window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
          await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: normalizedEmail,
            to_name: fullName,
            temp_password: tempPassword,
            certificate_code: certificateCode,
            login_url: loginUrl,
            course: enrollmentCourse || "General",
            message_html: emailHtml
          });
          emailSendResult = { attempted: true, sent: true };
          await addDoc(collection(db, "notifications"), {
            type: "registration",
            message: `Walk-in student account created for ${fullName}. Login email sent to ${normalizedEmail}.`,
            createdAt: new Date().toISOString(),
            read: false,
            email: currentUser?.email || "admin@bhf.com"
          });
        } catch (emailError) {
          console.error("EmailJS send failed for walk-in registration", emailError);
          emailSendResult = { attempted: true, sent: false, error: emailError?.message || "Email delivery failed" };
          await addDoc(collection(db, "notifications"), {
            type: "registration",
            message: `Walk-in student account created for ${fullName}, but the login email to ${normalizedEmail} failed to send. Share the temporary password with them directly.`,
            createdAt: new Date().toISOString(),
            read: false,
            email: currentUser?.email || "admin@bhf.com"
          });
        }
      } else {
        // EmailJS isn't configured yet — log it so the admin can see/copy
        // the credentials and share them manually in the meantime.
        console.log("Walk-in Registration Email (EmailJS not configured — not actually sent):", {
          to: normalizedEmail,
          subject: "Your BHF Academy Student Account Created",
          html: emailHtml
        });
        emailSendResult = { attempted: true, sent: false, error: "EmailJS not configured" };
        await addDoc(collection(db, "notifications"), {
          type: "registration",
          message: `Walk-in student account created for ${fullName}. Email delivery isn't configured yet, so share the temporary password with ${normalizedEmail} directly.`,
          createdAt: new Date().toISOString(),
          read: false,
          email: currentUser?.email || "admin@bhf.com"
        });
      }
    }
    
    return {
      success: true,
      uid,
      email: normalizedEmail,
      fullName,
      tempPassword,
      certificateCode,
      enrollmentCourse,
      hasCertificateFile,
      emailSendResult
    };
  } catch (error) {
    console.error("Failed to create walk-in student", error);
    throw new Error(error.message || "Failed to create student account");
  }
};

/* =============================================
   Backward-compat globals
   script.js used to be a classic (non-module) script,
   so its top-level consts/functions were implicitly
   visible to every other inline <script> on the page
   (course-detail.html, programs.html, etc.). Now that
   it's an ES module for Firebase imports, nothing
   leaks out automatically — so anything those other
   inline scripts still call has to be attached to
   window explicitly here.
============================================= */
window.getAuth = getAuth;
window.isAdmin = isAdmin;
window.isInstructor = isInstructor;
window.isAdminOrInstructor = isAdminOrInstructor;
window.getPortalHref = getPortalHref;
window.getInstructors = getInstructors;
window.loadInstructorsCache = loadInstructorsCache;
window.createInstructorAccount = createInstructorAccount;
window.removeInstructorAccount = removeInstructorAccount;
window.isAuthenticated = isAuthenticated;
window.findSavedCourse = findSavedCourse;
window.getSavedCourses = getSavedCourses;
window.BHF_COURSES = BHF_COURSES;
window.mergeCoursesWithSaved = mergeCoursesWithSaved;
window.getCourseCatalog = getCourseCatalog;
window.getEnrollments = getEnrollments;
window.saveEnrollments = saveEnrollments;
window.getCourseAccessPayments = getCourseAccessPayments;
window.saveCourseAccessPayments = saveCourseAccessPayments;
window.hasPurchasedCourseAccess = hasPurchasedCourseAccess;
window.markCourseAccessPaid = markCourseAccessPaid;
window.canAccessCourse = canAccessCourse;
window.canAccessCertificate = canAccessCertificate;
window.courseRequiresPayment = courseRequiresPayment;
window.updateHeaderAuthLink = updateHeaderAuthLink;
window.normalizeCourseTitle = normalizeCourseTitle;
window.showToast = showToast;
window.authReadyPromise = authReadyPromise;
window.coursesReadyPromise = coursesReadyPromise;
window.ADMIN_EMAIL = ADMIN_EMAIL;
// Certificate helpers, exposed for course-detail.html's plain (non-module)
// inline script, which can't `import` from script.js directly.
window.createCertificateFor = createCertificateFor;
window.createWalkinStudent = createWalkinStudent;
window.findUserCertificate = findUserCertificate;
window.getUserCertificates = getUserCertificates;
window.fetchUserCertificate = fetchUserCertificate;
window.certificatesReadyPromise = certificatesReadyPromise;
window.applyCertificateTemplate = applyCertificateTemplate;

// Admin Dashboard data (Enrollees, Upcoming Exams, Calendar, Notifications),
// exposed for admin.html and programs.html's plain (non-module) scripts.
window.loadEnrollmentsCache = loadEnrollmentsCache;
window.getEnrollmentRecords = getEnrollmentRecords;
window.recordEnrollment = recordEnrollment;
window.loadNotificationsCache = loadNotificationsCache;
window.getNotificationRecords = getNotificationRecords;
window.createNotification = createNotification;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.loadExamScheduleCache = loadExamScheduleCache;
window.getExamSchedule = getExamSchedule;
window.addExamScheduleEntry = addExamScheduleEntry;
window.removeExamScheduleEntry = removeExamScheduleEntry;

/* Certificate download and print functions */
window.downloadCertificate = async (elementId, fileName) => {
  const element = document.getElementById(elementId);
  if (!element) {
    alert("Certificate not found!");
    return;
  }

  if (typeof html2canvas !== 'function') {
    alert("Certificate rendering is unavailable because html2canvas is blocked. Please open the certificate directly in a new tab.");
    return;
  }

  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true
    });

    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const ratio = canvas.width / canvas.height;
      let imgWidth = pdfWidth - margin * 2;
      let imgHeight = imgWidth / ratio;
      if (imgHeight > pdfHeight - margin * 2) {
        imgHeight = pdfHeight - margin * 2;
        imgWidth = imgHeight * ratio;
      }
      const x = (pdfWidth - imgWidth) / 2;
      const y = (pdfHeight - imgHeight) / 2;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imgWidth, imgHeight);
      pdf.save(`${fileName || "Certificate"}.pdf`);
      showToast("Certificate downloaded successfully!", "success");
      return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${fileName || "Certificate"}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Certificate downloaded successfully!", "success");
  } catch (error) {
    console.error("Download failed:", error);
    showToast("Failed to download certificate", "error");
  }
};

window.printCertificate = (elementId) => {
  const element = document.getElementById(elementId);
  if (!element) {
    alert("Certificate not found!");
    return;
  }

  const printWindow = window.open("", "", "height=800,width=1000");
  printWindow.document.write("<html><head><title>Print Certificate</title>");
  printWindow.document.write("<style>");
  printWindow.document.write("body { margin: 0; padding: 20px; }");
  printWindow.document.write("@media print { body { margin: 0; padding: 0; } }");
  printWindow.document.write("</style></head><body>");
  printWindow.document.write(element.innerHTML);
  printWindow.document.write("</body></html>");
  printWindow.document.close();
  
  setTimeout(() => {
    printWindow.print();
  }, 250);
};

// Downloads the ACTUAL admin-uploaded certificate file when one exists for
// this record, so what the person gets is exactly the certificate the admin
// uploaded — not a screenshot of the page around it. The download is always
// a PDF: if the admin uploaded a PDF it's saved as-is, and if they uploaded
// an image it gets wrapped into a one-page PDF. Falls back to the old
// screenshot-based PDF download for certificates that only ever had the
// auto-generated design (no file uploaded).
window.downloadVerifiedCertificate = (record, elementId, fileNameBase) => {
  const uploadedUrl = record?.certificateFileUrl;
  const name = fileNameBase || "Certificate";
  if (!uploadedUrl) {
    window.downloadCertificate(elementId, name);
    return;
  }

  const isPdf = /^data:application\/pdf/i.test(uploadedUrl) || /\.pdf($|[?#])/i.test(record?.certificateFileName || "");

  if (isPdf) {
    try {
      const link = document.createElement("a");
      link.href = uploadedUrl;
      link.download = `${name}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Certificate downloaded successfully!", "success");
    } catch (e) {
      console.warn("Failed to download certificate file directly", e);
      try {
        window.open(uploadedUrl, "_blank", "noopener,noreferrer");
      } catch (openErr) {
        console.warn("Failed to open certificate file", openErr);
        showToast("Failed to download certificate", "error");
      }
    }
    return;
  }

  // Uploaded file is an image — wrap it into a single-page PDF so the
  // download is always a .pdf, regardless of what the admin uploaded.
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    // jsPDF isn't available for some reason — fall back to the raw image
    // rather than failing silently.
    try {
      const link = document.createElement("a");
      link.href = uploadedUrl;
      link.download = `${name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Certificate downloaded successfully!", "success");
    } catch (e) {
      console.warn("Failed to download certificate image", e);
      showToast("Failed to download certificate", "error");
    }
    return;
  }

  const img = new Image();
  img.onload = () => {
    try {
      const mimeMatch = /^data:image\/([a-zA-Z0-9+.-]+);base64,/.exec(uploadedUrl);
      const mime = (mimeMatch ? mimeMatch[1] : "png").toLowerCase();
      const format = mime.includes("jpeg") || mime.includes("jpg") ? "JPEG" : mime.includes("webp") ? "WEBP" : "PNG";
      const { jsPDF } = window.jspdf;
      const orientation = img.width >= img.height ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "pt", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const ratio = img.width / img.height;
      let imgWidth = pdfWidth - margin * 2;
      let imgHeight = imgWidth / ratio;
      if (imgHeight > pdfHeight - margin * 2) {
        imgHeight = pdfHeight - margin * 2;
        imgWidth = imgHeight * ratio;
      }
      const x = (pdfWidth - imgWidth) / 2;
      const y = (pdfHeight - imgHeight) / 2;
      pdf.addImage(uploadedUrl, format, x, y, imgWidth, imgHeight);
      pdf.save(`${name}.pdf`);
      showToast("Certificate downloaded successfully!", "success");
    } catch (e) {
      console.warn("Failed to build PDF from uploaded certificate image", e);
      showToast("Failed to download certificate", "error");
    }
  };
  img.onerror = () => {
    console.warn("Failed to load uploaded certificate image for PDF conversion");
    showToast("Failed to download certificate", "error");
  };
  img.src = uploadedUrl;
};

window.backToVerify = () => {
  const verifySection = document.getElementById("verify");
  const preview = document.getElementById("verify-certificate-preview");
  const form = document.getElementById("verify-form");
  
  if (verifySection) {
    verifySection.classList.remove("showing-certificate");
  }
  if (preview) {
    preview.innerHTML = "";
    preview.hidden = true;
  }
  if (form) {
    form.reset();
  }
  document.body.classList.remove('certificate-only');
  
  // Scroll back to the verify section
  verifySection?.scrollIntoView({ behavior: "smooth" });
};

(async function bootstrap() {
  // Optimistic render: if we have a cached snapshot from a previous
  // successful login, show it in the header immediately. This runs
  // synchronously (before the `await` below yields to the event loop), so
  // on every page navigation the profile pill appears right away instead of
  // flashing to "Login" for the second or so it takes Firebase to confirm
  // the session. The real onAuthStateChanged handler above will correct
  // this shortly after with the authoritative state (e.g. hide it again if
  // the user was actually signed out elsewhere).
  if (!currentUser) {
    const cachedUser = getLastUserSnapshot();
    if (cachedUser) {
      currentUser = cachedUser;
      updateHeaderAuthLink();
    }
  }
  // All of these are independent reads with no dependency on one another,
  // so they're fetched in parallel (one Promise.all) rather than one after
  // another — loadOverridesCache() used to be awaited separately AFTER this
  // Promise.all resolved, which added a full extra serial network round-trip
  // to every single page load for no reason.
  // Start essential background data loads in parallel but do NOT await
  // here — awaiting caused every page navigation to block until all
  // caches resolved, producing a visible delay. Individual pages can
  // still `await window.dataReadyPromise` when they need the data.
  const loadIfNeeded = [
    authReadyPromise,
    watchCourses(),
    watchCertificates(),
    watchCategories(),
    loadOverridesCache().catch((err) => console.warn('loadOverridesCache failed', err))
  ];

  if (page === 'dashboard' || page === 'admin' || page === 'manage-courses' || page === 'manage-users' || page === 'manage-instructors') {
    loadIfNeeded.push(loadEnrollmentsCache().catch((err) => console.warn('loadEnrollmentsCache failed', err)));
    if (page === 'manage-instructors') {
      loadIfNeeded.push(loadInstructorsCache().catch((err) => console.warn('loadInstructorsCache failed', err)));
    }
  }

  window.dataReadyPromise = Promise.all(loadIfNeeded).catch((err) => console.warn('dataReadyPromise failed', err));

  // BUGFIX: applyContentOverrides(page) below runs synchronously, before
  // loadOverridesCache() above has actually finished fetching the
  // "overrides" collection from Firestore (overridesCache starts out as
  // {} and the fetch is a network round-trip). That meant every admin
  // Edit Mode save (text, images, titles, descriptions, position/size)
  // only reappeared after a refresh if the Firestore fetch happened to
  // resolve before this code ran — which in practice it essentially never
  // did — so saved edits looked like they were being lost on reload even
  // though they were persisted correctly in Firestore the whole time. Only
  // the home page's "Programs Overview" cards had a working reapply path
  // (reapplyHomeOverrides(), wired to window.dataReadyPromise); every other
  // editable element on every other page did not. Re-apply overrides here
  // once the fetch has actually resolved so saved edits show up reliably
  // on refresh, browser restart, and future visits, on every page.
  window.dataReadyPromise.then(() => {
    try {
      applyContentOverrides(page);
    } catch (error) {
      console.warn("applyContentOverrides failed (post data-ready)", error);
    }
  });

  if (page === "dashboard") {
    if (!currentUser) {
      window.location.href = "login.html";
      return;
    }
    if (currentUser.role === "admin" || currentUser.role === "instructor" || currentUser.role === "superadmin") {
      window.location.href = getPortalHref(currentUser.role);
      return;
    }
  }

  if (page !== "home") {
    document.body.classList.remove('certificate-only');
    document.querySelectorAll('.verify-section.showing-certificate').forEach((section) => section.classList.remove('showing-certificate'));
  }

  try {
    applyContentOverrides(page);
  } catch (error) {
    console.warn("applyContentOverrides failed", error);
  }
  updateHeaderAuthLink();
  bindLoginForm();
  bindLogoutButtons();
  window.addEventListener("DOMContentLoaded", () => {
    try {
      applyContentOverrides(page);
    } catch (error) {
      console.warn("applyContentOverrides failed", error);
    }
    updateHeaderAuthLink();
    bindLoginForm();
    bindLogoutButtons();
  });
  window.addEventListener("load", updateHeaderAuthLink);
  window.addEventListener("pageshow", updateHeaderAuthLink);

  try {
    await runPageLogic();
  } catch (error) {
    console.warn('runPageLogic failed', error);
  }

// Page-specific initializers
if (page === 'admin-certificates') {
  // certificates.html registers window.initAdminCertificates from its own
  // <script type="module"> tag, which runs as a sibling to this file rather
  // than something this file waits on directly. Normally that registration
  // finishes well before we get here, but on a fast/local setup (or a slow
  // network delaying this file's own async work less than usual) the two
  // can race. Poll briefly instead of assuming it's already defined, so a
  // few milliseconds of bad luck doesn't silently break certificate init.
  (async () => {
    let waited = 0;
    while (typeof window.initAdminCertificates !== 'function' && waited < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      waited += 20;
    }
    if (typeof window.initAdminCertificates === 'function') {
      window.initAdminCertificates().catch((err) => console.warn('initAdminCertificates failed', err));
    } else {
      console.warn('initAdminCertificates was never registered by certificates.html');
    }
  })();
}

// Show a persistent banner on admin pages when storage or Firestore access
// is blocked, with actionable guidance for the developer/admin.
const renderPermissionBanner = () => {
  if (!document.body) return;
  const isAdminPage = page && page.startsWith('admin');
  if (!isAdminPage) return;
  const shouldShow = FIRESTORE_PERMISSION_DENIED || !checkStorageAccess();
  if (!shouldShow) return;
  // Avoid duplicating banner
  if (document.getElementById('bhf-permission-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'bhf-permission-banner';
  banner.style.background = '#fff4e5';
  banner.style.border = '1px solid #ffd89b';
  banner.style.padding = '0.8rem 1rem';
  banner.style.margin = '0';
  banner.style.fontWeight = '600';
  banner.style.color = '#6b3f00';
  banner.innerHTML = `
    <div style="display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap;">
      <div>
        ${FIRESTORE_PERMISSION_DENIED ? 'Firestore read permissions are blocked. ' : ''}
        ${!checkStorageAccess() ? 'Browser blocked localStorage/cookies for this origin. ' : ''}
        For local testing: allow storage for this host and ensure Firestore rules permit authenticated admin reads.
      </div>
      <div style="display:flex;gap:.6rem;align-items:center;">
        <a href="#" id="bhf-permission-instructions" style="background:#fff;color:#6b3f00;padding:.45rem .6rem;border-radius:8px;text-decoration:none;border:1px solid rgba(0,0,0,0.06);">Instructions</a>
      </div>
    </div>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
  document.getElementById('bhf-permission-instructions')?.addEventListener('click', (e) => {
    e.preventDefault();
    alert('To fix:\n\n1) Allow cookies/storage for your Live Server origin in Edge/Chrome (e.g. 127.0.0.1:5500).\n2) In Firebase Console → Firestore → Rules, temporarily allow reads for testing:\n\nrules_version = \"2\";\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} { allow read: if request.auth != null; }\n  }\n}\n\nOr for development only: allow read, write: if true; (DO NOT use in production).');
  });
};

renderPermissionBanner();
  // Initialize inline admin edit toggle for admins even if page logic has issues
  initAdminInlineEdit?.();
})();

/* Inline admin edit tools: allow admins to click page elements and save
   content overrides directly without using the admin page form. */
function initAdminInlineEdit() {
  // Admins can use inline Edit Mode on the auth pages only when those pages
  // are opened from the admin experience (for example via the admin sidebar).
  // Opening login/signup directly as standalone files should not expose it.
  const isAuthPage = page === "login" || page === "signup";
  const cameFromAdmin = new URLSearchParams(window.location.search).get("from") === "admin";
  const canUseEditMode = isAdmin() && (isAuthPage ? cameFromAdmin : true)
    || (isInstructor() && page === "programs");
  if (!canUseEditMode) return;

  const pageKey = page;
  let editMode = false;
  let lastHighlighted = null;
  const editHistory = [];
  let historyLocked = false;

  const toggle = document.createElement('button');
  toggle.id = 'bhf-admin-edit-toggle';
  toggle.type = 'button';
  toggle.title = 'Toggle edit mode';
  toggle.textContent = 'Edit Mode';
  document.body.appendChild(toggle);

  const undoButton = document.createElement('button');
  undoButton.id = 'bhf-admin-edit-undo';
  undoButton.type = 'button';
  undoButton.title = 'Undo last edit';
  undoButton.textContent = 'Undo';
  undoButton.disabled = true;
  document.body.appendChild(undoButton);

  let pageToggleButton = document.getElementById('bhf-admin-edit-page-button');
  const editPageContainers = ['page-title', 'admin-actions', 'page-shell'];
  if (!pageToggleButton && ['programs', 'admin', 'home', 'verify'].includes(pageKey)) {
    const container = editPageContainers
      .map((selector) => document.querySelector(`.${selector}`))
      .find(Boolean);

    if (container) {
      pageToggleButton = document.createElement('button');
      pageToggleButton.id = 'bhf-admin-edit-page-button';
      pageToggleButton.type = 'button';
      pageToggleButton.title = 'Toggle edit mode';
      pageToggleButton.textContent = 'Edit Mode';
      pageToggleButton.className = 'bhf-admin-edit-page-button';
      container.appendChild(pageToggleButton);
    }
  }

  if (pageToggleButton && pageKey === 'programs') {
    pageToggleButton.style.position = 'absolute';
    pageToggleButton.style.top = '1.75rem';
    pageToggleButton.style.right = '1.75rem';
    pageToggleButton.style.zIndex = '10';
  }

  const updateUndoState = () => {
    undoButton.disabled = editHistory.length === 0;
  };

  const updateToggleText = () => {
    const label = editMode ? 'Disable edit mode' : 'Edit Mode';
    toggle.textContent = label;
    if (pageToggleButton) pageToggleButton.textContent = label;
  };

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const openImageEditor = async (currentUrl) => {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'bhf-admin-image-editor-overlay';
      overlay.innerHTML = `
        <div class="bhf-admin-image-editor">
          <h2>Edit Image</h2>
          <p>Paste an image URL, upload a local image, or use clipboard image.</p>
          <label class="bhf-admin-image-label">Image URL
            <input type="text" id="bhf-admin-image-url" placeholder="https://..." />
          </label>
          <div class="bhf-admin-image-actions">
            <input type="file" id="bhf-admin-image-file" accept="image/*" />
            <button type="button" id="bhf-admin-image-paste">Paste clipboard image</button>
          </div>
          <div class="bhf-admin-image-error" id="bhf-admin-image-error"></div>
          <div class="bhf-admin-image-buttons">
            <button type="button" id="bhf-admin-image-cancel">Cancel</button>
            <button type="button" id="bhf-admin-image-save">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const urlInput = overlay.querySelector('#bhf-admin-image-url');
      const fileInput = overlay.querySelector('#bhf-admin-image-file');
      const pasteButton = overlay.querySelector('#bhf-admin-image-paste');
      const errorBox = overlay.querySelector('#bhf-admin-image-error');
      const saveButton = overlay.querySelector('#bhf-admin-image-save');
      const cancelButton = overlay.querySelector('#bhf-admin-image-cancel');

      urlInput.value = currentUrl || '';
      if (!navigator.clipboard || !navigator.clipboard.read) {
        pasteButton.disabled = true;
        pasteButton.textContent = 'Clipboard paste unavailable';
      }

      const cleanup = () => {
        overlay.remove();
      };

      const setError = (message) => {
        if (errorBox) errorBox.textContent = message;
      };

      const submit = async () => {
        const value = urlInput.value.trim();
        if (!value) {
          setError('Enter a valid image URL or upload/paste an image.');
          return;
        }
        cleanup();
        resolve(value);
      };

      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await fileToDataUrl(file);
          urlInput.value = dataUrl;
          setError('');
        } catch (err) {
          setError('Unable to read the selected file.');
        }
      });

      pasteButton.addEventListener('click', async () => {
        if (!navigator.clipboard || !navigator.clipboard.read) {
          setError('Clipboard image support is unavailable in this browser.');
          return;
        }

        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find((type) => type.startsWith('image/'));
            if (type) {
              const blob = await item.getType(type);
              const dataUrl = await fileToDataUrl(blob);
              urlInput.value = dataUrl;
              setError('');
              showToast('Clipboard image loaded. Click Save to apply.', 'success');
              return;
            }
          }
          setError('No image found in clipboard. Copy an image and try again.');
        } catch (err) {
          console.error('Clipboard read failed', err);
          setError('Unable to read clipboard data. Try using image URL or upload.');
        }
      });

      cancelButton.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      saveButton.addEventListener('click', submit);

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') {
          cleanup();
          resolve(null);
        }
      });

      urlInput.focus();
    });
  };

  const pushEditHistory = (entry) => {
    if (historyLocked) return;
    editHistory.push(entry);
    updateUndoState();
  };

  const applyOverrideValue = (selector, type, value) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (!element) return;
      if (type === 'image' && element.tagName === 'IMG') {
        element.src = value;
      } else if (type === 'text' && ADMIN_TEXT_TAGS.includes(element.tagName)) {
        if (hasUnsafeDescendant(element)) return; // see hasUnsafeDescendant comment above
        element.textContent = value;
      } else if (type === 'position') {
        try {
          const pos = value ? JSON.parse(value) : { x: 0, y: 0 };
          applyOffset(element, Number(pos.x) || 0, Number(pos.y) || 0);
        } catch (err) {
          applyOffset(element, 0, 0);
        }
      } else if (type === 'size') {
        try {
          const size = value ? JSON.parse(value) : {};
          applySize(element, size.width, size.height);
        } catch (err) {
          applySize(element, null, null);
        }
      }
    });
  };

  // --- Drag-to-move support -------------------------------------------------
  // Reads any offset already applied to an element, whether it was set by a
  // previous drag in this session (dataset) or restored from a saved
  // "position" override on page load (inline transform style).
  const getStoredOffset = (el) => {
    if (el.dataset.bhfOffsetX !== undefined || el.dataset.bhfOffsetY !== undefined) {
      return {
        x: parseFloat(el.dataset.bhfOffsetX || '0') || 0,
        y: parseFloat(el.dataset.bhfOffsetY || '0') || 0
      };
    }
    const match = (el.style.transform || '').match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/);
    if (match) return { x: parseFloat(match[1]) || 0, y: parseFloat(match[2]) || 0 };
    return { x: 0, y: 0 };
  };

  const applyOffset = (el, x, y) => {
    el.style.transform = (x || y) ? `translate(${x}px, ${y}px)` : '';
    el.dataset.bhfOffsetX = String(x);
    el.dataset.bhfOffsetY = String(y);
  };

  // --- Resize support --------------------------------------------------------
  const RESIZE_HANDLE_ZONE = 18; // px hot-zone around the bottom-right corner
  const MIN_SIZE = 24; // smallest an element can be resized down to

  const isInResizeHandle = (el, clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    return (
      clientX >= rect.right - RESIZE_HANDLE_ZONE && clientX <= rect.right + 8 &&
      clientY >= rect.bottom - RESIZE_HANDLE_ZONE && clientY <= rect.bottom + 8
    );
  };

  const getStoredSize = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      width: parseFloat(el.style.width) || rect.width,
      height: parseFloat(el.style.height) || rect.height
    };
  };

  const applySize = (el, width, height) => {
    if (width) {
      el.style.width = `${Math.round(width)}px`;
      el.dataset.bhfWidth = String(Math.round(width));
    } else {
      el.style.width = '';
      delete el.dataset.bhfWidth;
    }
    if (height) {
      el.style.height = `${Math.round(height)}px`;
      el.dataset.bhfHeight = String(Math.round(height));
    } else {
      el.style.height = '';
      delete el.dataset.bhfHeight;
    }
    if (el.tagName === 'IMG' && (width || height)) el.style.objectFit = 'cover';
  };

  const DRAG_THRESHOLD = 4;
  let dragState = null;
  let suppressNextClick = false;

  const onMouseDown = (e) => {
    if (e.button !== 0) return; // left click only
    const ignoreControl = e.target.closest('#bhf-admin-edit-toggle, #bhf-admin-edit-undo, #bhf-admin-edit-page-button');
    if (ignoreControl) return;
    const el = e.target;
    if (!isSafeAdminElement(el)) return;
    const selector = getDomPathSelector(el);
    if (!selector) return;

    if (isInResizeHandle(el, e.clientX, e.clientY)) {
      const baseSize = getStoredSize(el);
      dragState = { el, selector, mode: 'resize', startX: e.clientX, startY: e.clientY, baseWidth: baseSize.width, baseHeight: baseSize.height, moved: false };
      return;
    }

    const base = getStoredOffset(el);
    dragState = { el, selector, mode: 'move', startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y, moved: false };
  };

  const onMouseMove = (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (dragState.mode === 'resize') {
      if (!dragState.moved) {
        dragState.moved = true;
        dragState.el.classList.add('bhf-admin-edit-resizing');
      }
      const newWidth = Math.max(MIN_SIZE, Math.round(dragState.baseWidth + dx));
      const newHeight = Math.max(MIN_SIZE, Math.round(dragState.baseHeight + dy));
      applySize(dragState.el, newWidth, newHeight);
      return;
    }

    if (!dragState.moved) {
      dragState.moved = true;
      dragState.el.classList.add('bhf-admin-edit-dragging');
    }
    applyOffset(dragState.el, Math.round(dragState.baseX + dx), Math.round(dragState.baseY + dy));
  };

  const onMouseUp = () => {
    if (!dragState) return;
    const { el, selector, mode, moved } = dragState;

    if (mode === 'resize') {
      el.classList.remove('bhf-admin-edit-resizing');
      const { baseWidth, baseHeight } = dragState;
      dragState = null;
      if (!moved) return;
      suppressNextClick = true;
      const finalSize = getStoredSize(el);
      const previousValue = JSON.stringify({ width: baseWidth, height: baseHeight });
      const newValue = JSON.stringify(finalSize);
      saveContentOverride(pageKey, selector, newValue, 'size');
      pushEditHistory({ pageKey, selector, type: 'size', previousValue, newValue });
      showToast('Size updated and saved.', 'success');
      return;
    }

    const { baseX, baseY } = dragState;
    el.classList.remove('bhf-admin-edit-dragging');
    dragState = null;
    if (!moved) return; // treat as a normal click; let onClick open the editor

    suppressNextClick = true;
    const finalOffset = getStoredOffset(el);
    const previousValue = JSON.stringify({ x: baseX, y: baseY });
    const newValue = JSON.stringify(finalOffset);
    saveContentOverride(pageKey, selector, newValue, 'position');
    pushEditHistory({ pageKey, selector, type: 'position', previousValue, newValue });
    showToast('Position updated and saved.', 'success');
  };

  const undoLastEdit = async () => {
    if (!editHistory.length) {
      showToast('Nothing to undo.', 'info');
      return;
    }

    const lastEdit = editHistory.pop();
    updateUndoState();
    historyLocked = true;

    try {
      if (lastEdit.courseTitle) {
        await updateSavedCourse(lastEdit.courseTitle, { img: lastEdit.previousValue || '' });
        window.renderCourses?.();
      } else if (lastEdit.categoryName) {
        await updateSavedCategory(lastEdit.categoryName, { img: lastEdit.previousValue || '' });
      } else {
        applyOverrideValue(lastEdit.selector, lastEdit.type, lastEdit.previousValue || '');
        if (lastEdit.previousValue == null) {
          clearContentOverride(lastEdit.pageKey, lastEdit.selector, { skipRemote: false });
        } else {
          saveContentOverride(lastEdit.pageKey, lastEdit.selector, lastEdit.previousValue, lastEdit.type, { skipHistory: true });
        }
      }
      showToast('Undo complete: previous value restored.', 'success');
    } catch (error) {
      console.error('Undo failed', error);
      showToast('Undo failed. Please try again.', 'error');
    }

    historyLocked = false;
  };

  const getDomPathSelector = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentNode;
      if (!parent) break;
      // Dynamically-rendered list items (e.g. Program Category cards) can
      // change order/count between renders, which breaks a plain
      // nth-of-type index. If this node or its own container carries a
      // stable identifying attribute, anchor the selector to that instead
      // of its position so saved edits keep targeting the right element.
      const stableAttr = node.getAttribute && (node.getAttribute('data-category') ? 'data-category' : null);
      if (stableAttr) {
        parts.unshift(`${tag}[${stableAttr}="${node.getAttribute(stableAttr).replace(/"/g, '\\"')}"]`);
      } else {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          const ix = siblings.indexOf(node) + 1;
          parts.unshift(`${tag}:nth-of-type(${ix})`);
        } else {
          parts.unshift(tag);
        }
      }
      node = parent;
    }
    return parts.join(' > ');
  };

  const onMouseOver = (e) => {
    const el = e.target;
    if (lastHighlighted && lastHighlighted !== el) lastHighlighted.classList?.remove('bhf-admin-edit-highlight');
    if (isSafeAdminElement(el)) {
      el.classList?.add('bhf-admin-edit-highlight');
      lastHighlighted = el;
    }
  };

  const onClick = async (e) => {
    const overlay = e.target.closest('.bhf-admin-image-editor-overlay');
    if (overlay) return;
    const ignoreControl = e.target.closest('#bhf-admin-edit-toggle, #bhf-admin-edit-undo, #bhf-admin-edit-page-button');
    if (ignoreControl) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (!isSafeAdminElement(el)) {
      showToast('This element cannot be edited.', 'error');
      return;
    }

    const selector = getDomPathSelector(el);
    if (!selector) {
      showToast('Unable to determine selector for this element.', 'error');
      return;
    }

    // Only admins can push a change site-wide. Instructors (who only reach
    // this code on the Browse Programs page) always save scoped to that
    // page, so they can't accidentally overwrite shared content elsewhere.
    const targetPage = isAdmin() && window.confirm('Apply this change to all pages? OK = Yes, Cancel = This page only') ? 'global' : pageKey;
    const previousValue = el.tagName === 'IMG' ? el.src : el.textContent;

    if (el.tagName === 'IMG') {
      const url = await openImageEditor(el.src || '');
      if (!url) return;
      if (!isValidImageUrl(url)) {
        showToast('Invalid image URL.', 'error');
        return;
      }

      // Course thumbnails on the Browse Programs grid are rendered fresh
      // from Firestore course data every time the list re-renders (search,
      // filter, category modal, or the async reload once course data
      // finishes loading). A generic page/selector override can't survive
      // any of that because the element it points at gets thrown away and
      // rebuilt. So for these images we instead save straight to the
      // course's own `img` field — the actual source of truth — which
      // means the change shows up everywhere that course is used and
      // survives every re-render and reload automatically.
      const courseTitle = el.dataset.courseTitle || el.closest('[data-course-title]')?.dataset.courseTitle;
      if (courseTitle) {
        el.src = url;
        showToast('Saving image…', 'success');
        try {
          let updated = await updateSavedCourse(courseTitle, { img: url });
          if (!updated) {
            // No Firestore "courses" doc exists yet for this course — it's
            // still only a hard-coded default in BHF_COURSES, so
            // updateSavedCourse() (which only ever updates an *existing*
            // doc) had nothing to update and returned null. The image still
            // LOOKED saved because el.src was set above, but nothing was
            // actually persisted — so a few seconds later, once the page
            // re-rendered from the (unchanged) default data, the edit
            // reverted to the original image. Create the missing record
            // now, seeded from the built-in catalog entry plus the new
            // image, so the edit has somewhere permanent to live.
            const normalized = normalizeCourseTitle(courseTitle);
            const baseCourse = getCourseCatalog().find((c) => normalizeCourseTitle(c.title) === normalized);
            if (baseCourse) {
              await addSavedCourse({ ...baseCourse, img: url });
              updated = findSavedCourse(courseTitle);
            }
          }
          if (updated) {
            pushEditHistory({ pageKey: targetPage, selector, type: 'image', previousValue, newValue: url, courseTitle });
            showToast('Course image updated and saved.', 'success');
            window.renderCourses?.();
            // Also cascade this course's new picture up to its category's
            // shared image (same field the Home page's Featured Programs
            // card and the Programs page's category card both read from —
            // see updateSavedCategory). This is what makes "I edited this
            // course's thumbnail" show up on the Home page: the category
            // card doesn't have its own separate picture unless an admin
            // deliberately set one, so by default it just mirrors whichever
            // course thumbnail in that category was edited most recently.
            // Best-effort: a category card image is a nice-to-have, so this
            // never blocks or fails the course image save above it.
            const courseCategory = (updated.category || '').trim();
            if (courseCategory) {
              try {
                const categoryUpdated = await updateSavedCategory(courseCategory, { img: url });
                if (!categoryUpdated) await addSavedCategory(courseCategory).then(() => updateSavedCategory(courseCategory, { img: url }));
              } catch (categoryErr) {
                console.warn('Failed to cascade course image to category', categoryErr);
              }
            }
          } else {
            showToast("Couldn't find that course to save the image. Try again from the course list.", 'error');
          }
        } catch (err) {
          console.error('Failed to save course image', err);
          showToast("Image updated here, but saving to the server failed. It won't survive a reload.", 'error');
        }
        return;
      }

      // Program category card images (the "department"/"Featured Programs"
      // cards on both programs.html and the Home page) have the same
      // rebuilt-on-every-render problem as course thumbnails above, PLUS
      // they're shared across two different pages/containers with
      // different card sets (Home only shows the top 4 by enrollment), so
      // a page-scoped selector override can never reliably reach both. So
      // this also saves straight to the category's own `img` field —
      // shared, single source of truth — which is why editing a program
      // picture here now shows up on the Home page too, automatically.
      const categoryName = el.dataset.category || el.closest('[data-category]')?.dataset.category;
      if (categoryName) {
        el.src = url;
        showToast('Saving image…', 'success');
        try {
          let updated = await updateSavedCategory(categoryName, { img: url });
          if (!updated) {
            // No Firestore "categories" doc exists yet for this category
            // (it's still only inferred from BHF_COURSES defaults) — same
            // situation as a course with no saved doc yet. Create it now,
            // seeded with the new image, so the edit has somewhere
            // permanent to live.
            await addSavedCategory(categoryName);
            updated = await updateSavedCategory(categoryName, { img: url });
          }
          if (updated) {
            pushEditHistory({ pageKey: targetPage, selector, type: 'image', previousValue, newValue: url, categoryName });
            showToast('Program image updated and saved.', 'success');
          } else {
            showToast("Couldn't find that program category to save the image. Try again.", 'error');
          }
        } catch (err) {
          console.error('Failed to save category image', err);
          showToast("Image updated here, but saving to the server failed. It won't survive a reload.", 'error');
        }
        return;
      }

      el.src = url;
      pushEditHistory({ pageKey: targetPage, selector, type: 'image', previousValue, newValue: url });
      showToast('Saving image…', 'success');
      const result = await saveContentOverride(targetPage, selector, url, 'image');
      showToast(
        result.synced
          ? 'Image updated and saved.'
          : result.reason === 'not-signed-in'
            ? 'Image updated on this browser only — sign in as admin to save it for everyone.'
            : "Image updated here, but saving to the server failed. It won't survive a reload or show on other devices.",
        result.synced ? 'success' : 'error'
      );
    } else {
      const text = window.prompt('Enter new text content:', el.textContent || '');
      if (text === null) return;
      el.textContent = text;
      pushEditHistory({ pageKey: targetPage, selector, type: 'text', previousValue, newValue: text });
      showToast('Saving…', 'success');
      const result = await saveContentOverride(targetPage, selector, text, 'text');
      showToast(
        result.synced
          ? 'Text updated and saved.'
          : result.reason === 'not-signed-in'
            ? 'Text updated on this browser only — sign in as admin to save it for everyone.'
            : "Text updated here, but saving to the server failed. It won't survive a reload or show on other devices.",
        result.synced ? 'success' : 'error'
      );
    }
  };

  const enableEditMode = () => {
    if (editMode) return;
    editMode = true;
    toggle.classList.add('active');
    updateToggleText();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    showToast('Edit mode enabled. Click text/images to edit, drag to move, or drag the corner handle to resize.', 'info');
  };

  const disableEditMode = () => {
    if (!editMode) return;
    editMode = false;
    toggle.classList.remove('active');
    updateToggleText();
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    if (dragState?.el) {
      dragState.el.classList.remove('bhf-admin-edit-dragging');
      dragState.el.classList.remove('bhf-admin-edit-resizing');
    }
    dragState = null;
    suppressNextClick = false;
    if (lastHighlighted) lastHighlighted.classList.remove('bhf-admin-edit-highlight');
    lastHighlighted = null;
    showToast('Edit mode disabled.', 'info');
  };

  toggle.addEventListener('click', () => {
    if (!editMode) enableEditMode(); else disableEditMode();
  });

  if (pageToggleButton) {
    pageToggleButton.addEventListener('click', () => {
      if (!editMode) enableEditMode(); else disableEditMode();
    });
  }

  undoButton.addEventListener('click', undoLastEdit);

  document.addEventListener('keydown', (e) => {
    if (editMode && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      undoLastEdit();
      return;
    }
    if (e.key === 'Escape' && editMode) disableEditMode();
  });
}

async function runPageLogic() {

if (page === "home") {
  const auth = getAuth();
  const heroTitle = document.querySelector('.hero-copy h1');
  const welcomeCard = document.querySelector('.hero-copy .hero-welcome');
  /* FIX: was selecting by href="login.html", which updateHeaderAuthLink() had
     already changed by the time this ran. Now selects by a stable id instead. */
  const portalButton = document.getElementById('hero-portal-btn');

  if (auth) {
    const targetPage = getPortalHref(auth.role);
    if (heroTitle) {
      heroTitle.textContent = `Welcome back, ${auth.name.split(' ')[0]} — advance your career with trusted BHF learning programs.`;
    }
    // Signed-in users already get a personalized welcome message below, so
    // the generic marketing subtitle/paragraph aimed at first-time visitors
    // is redundant here. Hiding it noticeably shortens the hero for
    // returning users, who previously had to scroll past their own
    // greeting AND the full marketing pitch just to reach the stats and
    // the "verify a certificate" link.
    const heroSubtitle = document.querySelector('.hero-copy .hero-subtitle');
    const heroText = document.querySelector('.hero-copy .hero-text');
    if (heroSubtitle) heroSubtitle.style.display = 'none';
    if (heroText) heroText.style.display = 'none';
    if (welcomeCard) {
      welcomeCard.textContent = `You are signed in. Explore courses, manage your certifications, and review exam schedules.`;
      welcomeCard.style.display = "block";
    }
    if (portalButton) {
      portalButton.href = targetPage;
      portalButton.textContent = auth.role === "admin" ? "Admin Panel" : auth.role === "instructor" ? "Instructor Panel" : "My Dashboard";
    }
    // Signed-in visitors already have an account, so the "Create Free
    // Account" marketing CTA no longer applies to them — hide it.
    const signupButton = document.getElementById('hero-signup-btn');
    if (signupButton) signupButton.style.display = 'none';
  }

  const form = document.getElementById("verify-form");
  const result = document.getElementById("verify-result");
  const preview = document.getElementById("verify-certificate-preview");

  // Whenever the admin has uploaded an actual certificate file (image or
  // PDF) for this record, the verify page should show THAT file — not the
  // generic generated template design. This mirrors the same logic already
  // used on the admin dashboard's certificate preview/verification tab.
  const isUploadedCertificatePdf = (record) => {
    const url = record?.certificateFileUrl || "";
    const name = record?.certificateFileName || "";
    return url.startsWith("data:application/pdf") || /\.pdf$/i.test(name);
  };

  // Returns the markup that should sit inside the certificate card element,
  // preferring the admin's uploaded file over the generated design.
  const buildVerifiedCertificateInner = (record, safeName) => {
    const uploadedUrl = record?.certificateFileUrl;
    if (uploadedUrl) {
      return isUploadedCertificatePdf(record)
        ? `<div class="certificate-uploaded-file-wrapper">
             <div class="certificate-uploaded-file">
               <iframe src="${uploadedUrl}" title="Uploaded certificate" class="ctf-view-file-frame"></iframe>
             </div>
           </div>`
        : `<div class="certificate-uploaded-file-wrapper">
             <div class="certificate-uploaded-file">
               <img src="${uploadedUrl}" alt="Uploaded certificate for ${safeName}" class="ctf-view-file-image" />
             </div>
           </div>`;
    }
    return null;
  };

  const renderVerifyMessage = (message, ok) => {
    if (preview) {
      preview.innerHTML = "";
      preview.hidden = true;
    }
    result.innerHTML = message;
    result.style.color = ok === null ? "" : (ok ? "#114b88" : "#b33a3a");
    
    // Remove the showing-certificate class when displaying messages
    const verifySection = document.getElementById("verify");
    if (verifySection) {
      verifySection.classList.remove("showing-certificate");
    }
  };

  // Renders a verified certificate preview using an inline certificate card design.
  const renderVerifiedCertificate = async (record) => {
    if (!preview) return;
    const safeName = (record.name || 'Recipient Name').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeCourse = (record.course || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let safeDateText = record.date || '';
    if (!safeDateText && record.issuedAt) {
      const issued = new Date(record.issuedAt);
      if (!isNaN(issued.getTime())) {
        safeDateText = issued.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
    }
    const safeDate = safeDateText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeCode = (record.code || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let expiryLabel = record.expiryDate;
    if (!expiryLabel) {
      const issued = record.issuedAt ? new Date(record.issuedAt) : new Date(record.date);
      if (!isNaN(issued.getTime())) {
        const fallbackExpiry = new Date(issued);
        fallbackExpiry.setDate(fallbackExpiry.getDate() + 365);
        expiryLabel = fallbackExpiry.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
    }
    const safeExpiry = (expiryLabel || 'Not set').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const uploadedInner = buildVerifiedCertificateInner(record, safeName);
    const generatedInner = `
          <div class="certificate-inner">
            <div class="certificate-header">
              <div class="certificate-logo-rounded">
                <span class="certificate-logo-text">BHF</span>
              </div>
              <div class="certificate-brand-text">
                <div class="certificate-brand-title">BHF Certification Academy</div>
                <div class="certificate-brand-subtitle">Training &amp; Certification</div>
              </div>
            </div>

            <div class="certificate-title-block">
              <h1 class="certificate-main-title">BHF Certifications</h1>
              <p class="certificate-subtitle">Certificate of Completion</p>
            </div>

            <div class="certificate-body">
              <h2 class="certificate-recipient">${safeName}</h2>
              <p class="certificate-note">Has successfully completed the certification requirements and is authorized as a verified participant for the following program</p>
              <div class="certificate-program-row">
                <div class="certificate-program-text">
                  <strong>${safeCourse}</strong>
                  <p class="certificate-program-meta">Verified certification issued by BHF Certification Academy</p>
                </div>
                <svg class="certificate-badge-icon" viewBox="0 0 200 190" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <g stroke="var(--cert-accent)" stroke-width="2.4" stroke-linecap="round" fill="none">
                    <path d="M70 150 C40 150 20 130 18 100" />
                    <path d="M30 108 L18 100 L28 92" />
                    <path d="M35 122 L22 116 L30 106" />
                    <path d="M42 135 L28 132 L34 120" />
                    <path d="M52 145 L38 145 L42 132" />
                    <path d="M62 150 L48 152 L50 138" />
                  </g>
                  <g stroke="var(--cert-accent)" stroke-width="2.4" stroke-linecap="round" fill="none">
                    <path d="M130 150 C160 150 180 130 182 100" />
                    <path d="M170 108 L182 100 L172 92" />
                    <path d="M165 122 L178 116 L170 106" />
                    <path d="M158 135 L172 132 L166 120" />
                    <path d="M148 145 L162 145 L158 132" />
                    <path d="M138 150 L152 152 L150 138" />
                  </g>
                  <circle cx="100" cy="80" r="46" fill="var(--accent-dark)" />
                  <circle cx="100" cy="80" r="38" fill="#ffffff" stroke="var(--cert-accent)" stroke-width="2" />
                  <path d="M82 80 L94 92 L120 64" stroke="var(--cert-accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                  <g fill="var(--cert-accent)">
                    <path d="M86 158 l2.4 5 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
                    <path d="M100 162 l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9z" />
                    <path d="M114 158 l2.4 5 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
                  </g>
                </svg>
              </div>
              <p class="certificate-valid-through">Valid Through <strong>${safeExpiry}</strong></p>
            </div>

            <div class="certificate-footer">
              <div class="certificate-footer-col certificate-footer-left">
                <p class="certificate-detail-label">Validate this certificate's authenticity at</p>
                <p class="certificate-verify-link">bhf-training-and-certificate.web.app</p>
                <p class="certificate-detail-label" style="margin-top:0.6rem;">Certificate ID <span class="certificate-id-value">${safeCode}</span></p>
                <p class="certificate-detail-label" style="margin-top:0.6rem;">Date Issued <span class="certificate-id-value">${safeDate}</span></p>
              </div>
              <div class="certificate-footer-col certificate-footer-right">
                <svg class="certificate-signature-svg" viewBox="0 0 180 50" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8,35 C16,10 24,42 32,18 C40,-4 46,40 54,22 C62,6 70,32 78,16 C86,2 92,34 100,20 C108,8 114,30 122,18 C128,10 134,24 140,16 C146,10 152,20 158,14" fill="none" stroke="#1a1a1a" stroke-width="2.2" stroke-linecap="round" />
                </svg>
                <p class="certificate-detail certificate-signatory">Charles Wang</p>
                <p class="certificate-detail-label">Program Director</p>
              </div>
            </div>
          </div>
          <div class="certificate-ribbon"></div>`;

    preview.hidden = false;
    preview.innerHTML = `
      <div class="verified-certificate-wrapper">
        <div class="verified-certificate-card${uploadedInner ? ' verified-certificate-card--file' : ''}" id="verified-certificate-card">
          ${uploadedInner || generatedInner}
        </div>

        <aside class="certificate-modal-right">
          <div class="verified-certificate-info">
            <div class="certificate-verified-badge">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
              <span>Certificate Verified</span>
            </div>
            <div class="certificate-detail-list">
              <div class="certificate-detail-item">
                <span class="detail-label">Date Issued</span>
                <span class="detail-value">${safeDate}</span>
              </div>
              <div class="certificate-detail-item certificate-detail-item--id">
                <span class="detail-label">Certificate ID</span>
                <span class="detail-value detail-value--code">${safeCode}</span>
              </div>
              <div class="certificate-detail-item">
                <span class="detail-label">Expiry Date</span>
                <span class="detail-value">${safeExpiry}</span>
              </div>
            </div>

            <div class="verified-certificate-actions certificate-modal-button-row">
              <button class="btn btn-secondary certificate-btn-back" onclick="backToVerify()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>
                Back to Verify
              </button>
              <button class="btn btn-primary certificate-btn-download" id="verify-preview-download-btn" type="button">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
                Download Certificate
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    try {
      applyContentOverrides('home');
    } catch (error) {
      console.warn('Failed to apply admin overrides to verify preview', error);
    }

    const previewDownloadBtn = document.getElementById('verify-preview-download-btn');
    if (previewDownloadBtn) previewDownloadBtn.onclick = () => window.downloadVerifiedCertificate(record, 'verified-certificate-card', safeName.replace(/\s+/g, '-'));

    const verifySection = document.getElementById("verify");
    if (verifySection) {
      verifySection.classList.add("showing-certificate");
      document.body.classList.add('certificate-only');
      setTimeout(() => {
        verifySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.scrollBy(0, -90);
      }, 100);
    }
  };



  // Opens the same certificate modal used on the dashboard's "My
  // Certificates" page, populated with the verified record's details.
  const openVerifiedCertificateModal = async (record) => {
    const modal = document.getElementById("certificate-modal");
    const modalContent = document.getElementById("certificate-modal-content");
    if (!modal || !modalContent) return;

    const safeName = escapeHtml((currentUser && currentUser.name) || record.name || record.recipientName || "Recipient Name");
    const safeCourse = escapeHtml(record.course || 'the program');
    const safeDate = escapeHtml(record.date || "—");
    const safeCode = escapeHtml(record.code || "");

    let expiryLabel = record.expiryDate;
    if (!expiryLabel) {
      const issued = record.issuedAt ? new Date(record.issuedAt) : new Date(record.date);
      if (!isNaN(issued.getTime())) {
        const fallbackExpiry = new Date(issued);
        fallbackExpiry.setDate(fallbackExpiry.getDate() + 365);
        expiryLabel = fallbackExpiry.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
    }
    const safeExpiry = escapeHtml(expiryLabel || "Not set");

    const uploadedInnerModal = buildVerifiedCertificateInner(record, safeName);
    const generatedInnerModal = `
              <div class="certificate-inner">
                <div class="certificate-header">
                  <div class="certificate-logo-rounded">
                    <span class="certificate-logo-text">BHF</span>
                  </div>
                  <div class="certificate-brand-text">
                    <div class="certificate-brand-title">BHF Certification Academy</div>
                    <div class="certificate-brand-subtitle">Training &amp; Certification</div>
                  </div>
                </div>

                <div class="certificate-title-block">
                  <h1 class="certificate-main-title">BHF Certifications</h1>
                  <p class="certificate-subtitle">Certificate of Completion</p>
                </div>

                <div class="certificate-body">
                  <h2 class="certificate-recipient">${safeName}</h2>
                  <p class="certificate-note">Has successfully completed the certification requirements and is authorized as a verified participant for the following program</p>
                  <div class="certificate-program-row">
                    <div class="certificate-program-text">
                      <strong>${safeCourse}</strong>
                      <p class="certificate-program-meta">Verified certification issued by BHF Certification Academy</p>
                    </div>
                    <svg class="certificate-badge-icon" viewBox="0 0 200 190" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <g stroke="var(--cert-accent)" stroke-width="2.4" stroke-linecap="round" fill="none">
                        <path d="M70 150 C40 150 20 130 18 100" />
                        <path d="M30 108 L18 100 L28 92" />
                        <path d="M35 122 L22 116 L30 106" />
                        <path d="M42 135 L28 132 L34 120" />
                        <path d="M52 145 L38 145 L42 132" />
                        <path d="M62 150 L48 152 L50 138" />
                      </g>
                      <g stroke="var(--cert-accent)" stroke-width="2.4" stroke-linecap="round" fill="none">
                        <path d="M130 150 C160 150 180 130 182 100" />
                        <path d="M170 108 L182 100 L172 92" />
                        <path d="M165 122 L178 116 L170 106" />
                        <path d="M158 135 L172 132 L166 120" />
                        <path d="M148 145 L162 145 L158 132" />
                        <path d="M138 150 L152 152 L150 138" />
                      </g>
                      <circle cx="100" cy="80" r="46" fill="var(--accent-dark)" />
                      <circle cx="100" cy="80" r="38" fill="#ffffff" stroke="var(--cert-accent)" stroke-width="2" />
                      <path d="M82 80 L94 92 L120 64" stroke="var(--cert-accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                      <g fill="var(--cert-accent)">
                        <path d="M86 158 l2.4 5 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
                        <path d="M100 162 l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9z" />
                        <path d="M114 158 l2.4 5 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
                      </g>
                    </svg>
                  </div>
                  <p class="certificate-valid-through">Valid Through <strong>${safeExpiry}</strong></p>
                </div>

                <div class="certificate-footer">
                  <div class="certificate-footer-col certificate-footer-left">
                    <p class="certificate-detail-label">Validate this certificate's authenticity at</p>
                    <p class="certificate-verify-link">bhf-training-and-certificate.web.app</p>
                    <p class="certificate-detail-label" style="margin-top:0.6rem;">Certificate ID <span class="certificate-id-value">${safeCode}</span></p>
                    <p class="certificate-detail-label" style="margin-top:0.6rem;">Date Issued <span class="certificate-id-value">${safeDate}</span></p>
                  </div>
                  <div class="certificate-footer-col certificate-footer-right">
                    <svg class="certificate-signature-svg" viewBox="0 0 180 50" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8,35 C16,10 24,42 32,18 C40,-4 46,40 54,22 C62,6 70,32 78,16 C86,2 92,34 100,20 C108,8 114,30 122,18 C128,10 134,24 140,16 C146,10 152,20 158,14" fill="none" stroke="#1a1a1a" stroke-width="2.2" stroke-linecap="round" />
                    </svg>
                    <p class="certificate-detail certificate-signatory">Charles Wang</p>
                    <p class="certificate-detail-label">Program Director</p>
                  </div>
                </div>
              </div>
              <div class="certificate-ribbon"></div>`;

    modalContent.innerHTML = `
      <div id="verify-certificate-card" class="verified-certificate-wrapper certificate-modal-expanded">
        <div class="certificate-modal-columns">
          <div class="certificate-modal-left">
            <div id="verify-certificate-image" class="verified-certificate-card${uploadedInnerModal ? ' verified-certificate-card--file' : ''}">
              ${uploadedInnerModal || generatedInnerModal}
            </div>
          </div>
          <aside class="certificate-modal-right">
            <div class="verified-certificate-info">
              <div class="certificate-status-row">
                <div class="certificate-status-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
                </div>
                <div class="certificate-status-text">
                  <p class="certificate-status-title">Certificate Verified</p>
                  <p class="certificate-status-sub">This certificate is valid and verified.</p>
                </div>
              </div>

              <div class="certificate-detail-list">
                <div class="certificate-detail-item">
                  <div class="certificate-detail-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div class="certificate-detail-text">
                    <span class="detail-label">Date Issued</span>
                    <span class="detail-value">${safeDate}</span>
                  </div>
                </div>
                <div class="certificate-detail-item certificate-detail-item--id">
                  <div class="certificate-detail-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="6" y1="15" x2="10" y2="15"></line><line x1="14" y1="15" x2="18" y2="15"></line><circle cx="8" cy="10" r="1.5"></circle></svg>
                  </div>
                  <div class="certificate-detail-text certificate-detail-text--id">
                    <span class="detail-label">Certificate ID</span>
                    <div class="certificate-id-box">
                      <span class="detail-value detail-value--code" id="verify-modal-code-text">${safeCode}</span>
                      <button type="button" class="certificate-id-copy" id="verify-modal-copy" aria-label="Copy certificate ID">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="certificate-detail-item">
                  <div class="certificate-detail-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div class="certificate-detail-text">
                    <span class="detail-label">Expiry Date</span>
                    <span class="detail-value">${safeExpiry}</span>
                  </div>
                </div>
              </div>

              <div class="verified-certificate-actions certificate-modal-button-row">
                <button class="btn btn-secondary certificate-btn-back" onclick="backToVerify()">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>
                  Back to Verify
                </button>
                <button class="btn btn-primary certificate-btn-download" id="verify-modal-download">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
                  Download Certificate
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    const closeBtn = document.getElementById("certificate-modal-close");
    const modalDownload = document.getElementById("verify-modal-download");
    const modalCopy = document.getElementById("verify-modal-copy");
    const closeModal = () => {
      modal.classList.add("hidden");
      // Reset verify form and messages when modal is closed
      const verifyForm = document.getElementById("verify-form");
      const verifyResult = document.getElementById("verify-result");
      if (verifyForm) verifyForm.reset();
      if (verifyResult) verifyResult.innerHTML = "";
    };

    // Use onclick (not addEventListener) for the static close button/overlay
    // so re-opening the modal never stacks duplicate handlers.
    closeBtn.onclick = closeModal;
    modal.onclick = (ev) => { if (ev.target === modal) closeModal(); };
    modalDownload.onclick = () => window.downloadVerifiedCertificate(record, "verify-certificate-image", safeName.replace(/\s+/g, "-"));
    modalCopy.onclick = () => {
      const codeText = document.getElementById("verify-modal-code-text")?.textContent || "";
      if (navigator.clipboard && codeText) {
        navigator.clipboard.writeText(codeText).then(() => {
          modalCopy.classList.add("is-copied");
          setTimeout(() => modalCopy.classList.remove("is-copied"), 1500);
        }).catch(() => {});
      }
    };
  };

  if (form && result) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const rawInput = document.getElementById("certificate-code").value;
      const code = normalizeCertificateCode(rawInput);
      
      // Extract the certificate code part — handle cases where users copy "Certificate ID BHFXXX..." or similar
      // First try to match at the end of the string (cleaner paste)
      let codeMatch = code.match(/BHF[A-Z0-9]{13}$/);
      // If not found at end, search anywhere in the string (handles extra text before/after)
      if (!codeMatch) {
        codeMatch = code.match(/BHF[A-Z0-9]{13}/);
      }
      const finalCode = codeMatch ? codeMatch[0] : code;

      if (finalCode.length !== 16 || !finalCode.match(/^BHF[A-Z0-9]{13}$/)) {
        renderVerifyMessage("Please enter a valid certificate code. It should be a 16-character code starting with BHF (example: BHFABCD1234XYZWV).", false);
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      renderVerifyMessage("Checking\u2026", null);

      try {
        // Always look this up live against Firestore (not the local cache),
        // so a certificate issued on any device, moments ago, verifies
        // correctly here — this is the whole point of "verify from another device".
        const record = await fetchCertificateByCode(finalCode);
        if (!record) {
          renderVerifyMessage("No matching certificate was found. Please contact the academy office.", false);
          return;
        }
        renderVerifyMessage("Certificate verified. Opening certificate…", true);
        result.style.color = "";

        try {
          await openVerifiedCertificateModal(record);
          const certificateModal = document.getElementById('certificate-modal');
          if (certificateModal) {
            certificateModal.classList.remove('hidden');
          }
        } catch (renderError) {
          console.error("Failed to open verified certificate modal", renderError);
          await renderVerifiedCertificate(record);
        }
      } catch (error) {
        console.error("Certificate verification failed", error);
        renderVerifyMessage("Something went wrong while verifying. Please try again.", false);
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  /* NEW: reveal-on-scroll for any element with the .reveal class */
  const revealTargets = document.querySelectorAll(".reveal");
  if (revealTargets.length) {
    if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      revealTargets.forEach((target) => revealObserver.observe(target));
    } else {
      // Fallback for browsers without IntersectionObserver support
      revealTargets.forEach((target) => target.classList.add("is-visible"));
    }
  }

  /* NEW: animated count-up for hero stats with a data-count attribute */
  // Skip the Programs page's "Certification Programs" / "Industry Categories"
  // stats here — those start out with placeholder data-count values (0 / 5)
  // baked into the HTML and only get their real numbers once
  // renderProgramsOverview() runs. Animating them here first would count up
  // to the wrong placeholder briefly before renderProgramsOverview corrects
  // it a moment later. renderProgramsOverview() drives their count-up itself
  // once the real numbers are known, so it's excluded from this generic pass.
  const countTargets = document.querySelectorAll(
    "[data-count]:not(#certification-programs-stat):not(#industry-categories-stat)"
  );
  const animateCount = (element) => {
    const target = Number(element.dataset.count) || 0;
    const suffix = element.dataset.suffix || "";
    const duration = 1200;
    const startTime = performance.now();

    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);
      element.textContent = `${current}${suffix}`;
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  if (countTargets.length) {
    if ("IntersectionObserver" in window) {
      const countObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCount(entry.target);
              countObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 }
      );
      countTargets.forEach((target) => countObserver.observe(target));
    } else {
      countTargets.forEach((target) => animateCount(target));
    }
  }

  /* Featured Programs preview on the homepage. Instead of listing every
     category (which just duplicated programs.html), this now shows only
     the top HOME_FEATURED_LIMIT categories ranked by enrollment count, so
     it's an actual "featured/most popular" snapshot. Enrollment counts
     come from live Firestore enrollment records (getEnrollmentRecords()),
     which each carry a "category" field. New categories added later are
     automatically eligible — they'll surface here on their own once they
     pick up enough enrollments; until then they simply rank lower and stay
     out of the top 4 (see programs.html for the full list). */
  const homeProgramsGrid = document.getElementById('home-programs-grid');
  const homeCategoryImages = {
    "Information Technology": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80"
  };
  const HOME_FEATURED_LIMIT = 4;
  const renderHomePrograms = () => {
    if (!homeProgramsGrid) return;
    const defaultCats = Array.from(new Set((typeof BHF_COURSES !== 'undefined' ? BHF_COURSES : []).map((c) => c.category).filter(Boolean)));
    const savedCats = (typeof getSavedCategories === 'function' ? getSavedCategories() : []).map((c) => c.name).filter(Boolean);
    const catalog = typeof getCourseCatalog === 'function' ? getCourseCatalog() : [];
    const categories = Array.from(new Set([...defaultCats, ...savedCats]))
      .filter((category) => {
        const normalizedCategory = (category || '').trim().toLowerCase();
        if (!normalizedCategory) return false;
        return catalog.some((course) => ((course.category || 'General') || '').trim().toLowerCase() === normalizedCategory);
      });

    if (!categories.length) {
      homeProgramsGrid.innerHTML = '<p class="form-note">Programs coming soon.</p>';
      return;
    }

    // Saved category images (set via Edit Mode, stored on the category's
    // own Firestore doc — see updateSavedCategory) take priority over the
    // hardcoded homeCategoryImages map, so an admin-edited program picture
    // shows up here AND on the Programs page, since both read from the
    // same category record.
    const savedCategoryImages = (typeof getSavedCategories === 'function' ? getSavedCategories() : [])
      .reduce((map, c) => {
        if (c.name && c.img) map[c.name] = c.img;
        return map;
      }, {});

    // Count enrollments per category (case/whitespace-insensitive match,
    // same normalization used above for categories vs. catalog courses).
    const enrollmentRecords = typeof getEnrollmentRecords === 'function' ? (getEnrollmentRecords() || []) : [];
    const enrollmentCounts = {};
    enrollmentRecords.forEach((record) => {
      const normalizedCategory = ((record && record.category) || '').trim().toLowerCase();
      if (!normalizedCategory) return;
      enrollmentCounts[normalizedCategory] = (enrollmentCounts[normalizedCategory] || 0) + 1;
    });

    // Stable sort by enrollment count, descending. Categories with no
    // enrollments yet (count 0) keep their original relative order, so
    // brand-new categories don't jump around — they just wait their turn
    // until they earn enough enrollments to crack the top 4.
    const featuredCategories = categories
      .map((category, index) => ({
        category,
        index,
        count: enrollmentCounts[category.trim().toLowerCase()] || 0
      }))
      .sort((a, b) => (b.count - a.count) || (a.index - b.index))
      .slice(0, HOME_FEATURED_LIMIT)
      .map((entry) => entry.category);

    homeProgramsGrid.innerHTML = featuredCategories.map((category) => {
      const matchingCourses = catalog.filter((course) => (course.category || 'General') === category);
      const img = savedCategoryImages[category]
        || homeCategoryImages[category]
        || matchingCourses.find((c) => c.img)?.img
        || 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=600&q=80';
      const desc = matchingCourses.length
        ? `${matchingCourses.length} certification course${matchingCourses.length === 1 ? '' : 's'} available.`
        : 'New program category — courses coming soon.';
      return `
        <article class="program-card reveal is-visible" data-category="${category.replace(/"/g, '&quot;')}">
          <img class="program-card-img" src="${img}" alt="${category} training" loading="lazy" data-category="${category.replace(/"/g, '&quot;')}" />
          <h3>${category}</h3>
          <p>${desc}</p>
          <a href="programs.html">Learn More</a>
        </article>
      `;
    }).join('');
    reapplyHomeOverrides();
  };
  const reapplyHomeOverrides = () => {
    try {
      if (typeof applyContentOverrides === "function") applyContentOverrides("home");
    } catch (error) {
      console.warn("Failed to re-apply overrides after rendering home programs", error);
    }
  };

  // Categories/courses/enrollments load asynchronously (see the
  // bootstrap() IIFE above), and this "home" block runs before that
  // finishes, so render once immediately with whatever's cached, then
  // again once the real data is in so ranking reflects live enrollment
  // counts without a second page reload. renderHomePrograms() itself
  // re-applies saved overrides after each render (see reapplyHomeOverrides
  // above) so admin edits to these cards survive both the async data
  // reload and a full page reload.
  renderHomePrograms();
  if (window.dataReadyPromise) {
    window.dataReadyPromise.then(renderHomePrograms);
  }
  // Categories now stream in live (see watchCategories()), so if this page
  // is left open while a category is added/removed elsewhere, re-render
  // right away instead of waiting for the visitor to reload.
  document.addEventListener('categories:updated', renderHomePrograms);
  // Courses now stream in live too (see watchCourses()), so a freshly
  // uploaded course shows up here right away as well.
  document.addEventListener('courses:updated', renderHomePrograms);
  // Enrollments stream in live too (see watchEnrollments() /
  // "enrollments:updated"), so the "most enrolled" ranking stays current
  // as new sign-ups come in, without needing a reload.
  document.addEventListener('enrollments:updated', renderHomePrograms);

  // ---------- Exam Schedule card ----------
  // This card used to be permanently hardcoded to "No scheduled exams
  // yet...", regardless of what admins had actually scheduled in
  // calendar.html. It never read the "examSchedule" Firestore collection
  // at all. This wires it up to the same shared collection calendar.html
  // writes to, so exams scheduled there actually show up here.
  //
  // Personalization: calendar.html can now target an exam at one specific
  // student (studentEmail) instead of the whole class. When the visitor is
  // signed in, this shows exams assigned to them personally plus any
  // whole-class exams for courses they're enrolled in. Signed-out visitors
  // see a generic preview of whole-class exams only, since there's no
  // student to personalize against.
  const renderHomeExamSchedule = async () => {
    const card = document.getElementById("home-exam-schedule");
    if (!card) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const all = (getExamSchedule() || []).filter((e) => e.examDate && e.examDate >= todayStr);

    let relevant;
    if (auth && auth.email) {
      // Need to know which courses this student is enrolled in, so
      // whole-class exams for THEIR courses are included alongside any
      // exams assigned to them by name. Not loaded by default on the
      // homepage, so pull it in now.
      await loadEnrollmentsCache().catch((err) => console.warn("Failed to load enrollments for exam schedule", err));
      const myEmail = auth.email.toLowerCase();
      const myCourses = new Set(
        (getEnrollmentRecords() || [])
          .filter((e) => (e.email || "").toLowerCase() === myEmail)
          .map((e) => e.course)
      );
      relevant = all.filter((e) => {
        const targetedAtMe = (e.studentEmail || "").toLowerCase() === myEmail;
        const wholeClassForMyCourse = !e.studentEmail && myCourses.has(e.course);
        return targetedAtMe || wholeClassForMyCourse;
      });
    } else {
      relevant = all.filter((e) => !e.studentEmail);
    }

    const upcoming = relevant
      .sort((a, b) => (a.examDate + (a.examTime || "")).localeCompare(b.examDate + (b.examTime || "")))
      .slice(0, 5);

    if (!upcoming.length) {
      card.innerHTML = auth
        ? `<p>No exams scheduled for your enrolled courses yet. Check back soon.</p>`
        : `<p>No scheduled exams yet. Check back soon for upcoming certification dates.</p>`;
      return;
    }

    const formatExamDate = (dateStr, timeStr) => {
      const d = new Date(`${dateStr}T${timeStr || "00:00"}`);
      if (isNaN(d.getTime())) return dateStr;
      const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return timeStr
        ? `${dateLabel} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : dateLabel;
    };

    const escapeHtml = (str) => (str || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const rows = upcoming.map((e) => `
      <li class="exam-schedule-row">
        <span>
          <span class="esr-course">${escapeHtml(e.title || e.course)}</span>
          <span class="esr-category">${e.studentEmail ? "Personally scheduled for you" : escapeHtml(e.category || "")}</span>
        </span>
        <span class="esr-date">${escapeHtml(formatExamDate(e.examDate, e.examTime))}</span>
      </li>
    `).join("");

    card.innerHTML = `
      <ul class="exam-schedule-list">${rows}</ul>
      ${auth ? "" : `<p class="exam-schedule-note">Sign in to see exam dates for your own enrolled courses.</p>`}
    `;
  };

  loadExamScheduleCache().then(renderHomeExamSchedule).catch((err) => {
    console.error("Failed to load exam schedule for homepage", err);
    const card = document.getElementById("home-exam-schedule");
    if (card) card.innerHTML = `<p>No scheduled exams yet. Check back soon for upcoming certification dates.</p>`;
  });
}

if (page === "signup") {
  if (isAuthenticated()) {
    // Admins are kept on the signup page (instead of being redirected)
    // so they can use the same "Edit Mode" / "Undo" inline editing
    // tools that appear on the other public pages.
    if (!isAdmin()) {
      window.location.href = getPostAuthHref(getAuth()?.role);
    }
  }
  bindSignupForm();
  bindForgotPasswordForms();
}

if (page === "programs") {
  const catalogBase = typeof BHF_COURSES !== "undefined" && Array.isArray(BHF_COURSES)
    ? BHF_COURSES
    : [];

  const defaultCourses = catalogBase.length
    ? catalogBase.map((course) => ({
        title: course.title,
        description: course.description || course.desc || "Professional certification course for continued learning.",
        level: course.level || "Intermediate",
        duration: course.duration || "4 Weeks",
        category: course.category || "General",
        img: course.img || course.image
      }))
    : [];

  const categoryImages = {
    "Information Technology": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80"
  };

  const getProgramCatalog = () => mergeCoursesWithSaved(defaultCourses);

  const grid = document.getElementById("courses-grid");
  const departmentsGrid = document.getElementById("departments");
  const search = document.getElementById("course-search");
  const filter = document.getElementById("course-filter");
  const countLabel = document.querySelector(".course-count");
  let activeCategory = null;

  // Global handlers for onclick attributes
  window.handlePayClick = (name, category) => {
    if (typeof window.openPaymentModal === 'function') {
      window.openPaymentModal(name, category);
    }
  };

  window.handleEnrollClick = async (name, category) => {
    const auth = getAuth();
    if (!auth || !auth.email) {
      window.location.href = 'login.html';
      return;
    }
    if (typeof window.enrollCourse === 'function') {
      window.enrollCourse(name, category);
    } else {
      const enrollments = getEnrollments ? getEnrollments() : {};
      const email = auth.email.toLowerCase();
      const current = Array.isArray(enrollments[email]) ? enrollments[email] : [];
      const isNewEnrollment = !current.includes(name);
      if (isNewEnrollment) {
        current.push(name);
        enrollments[email] = current;
        safeSetStorage(ENROLLMENT_STORE_KEY, JSON.stringify(enrollments));
      }
      // Await this so the redirect below can't cut the write off before
      // the enrollment doc is saved (needed for the Admin Dashboard).
      // Skip re-recording a course the student is already enrolled in —
      // otherwise every repeat click on "Enroll Now" wrote another
      // duplicate Firestore document, inflating the admin "Total
      // Enrollments" stat (recordEnrollment() also de-dupes internally
      // as a second safety net).
      if (isNewEnrollment) {
        await recordEnrollment({ email: auth.email, name: auth.name, course: name, category }).catch(() => {});
      }
      window.location.href = `course-detail.html?course=${encodeURIComponent(name)}&category=${encodeURIComponent(category)}`;
    }
  };


  const renderProgramsOverview = () => {
    const visibleCourses = getProgramCatalog();
    const categories = Array.from(new Set(
      visibleCourses.map((course) => (course.category || "General")).filter(Boolean)
    ));

    // Saved category images (set via Edit Mode, stored on the category's
    // own Firestore doc — see updateSavedCategory) take priority over the
    // hardcoded categoryImages map, so an admin-edited program picture
    // shows up here AND on the Home page's Featured Programs, since both
    // read from the same category record.
    const savedCategoryImages = (typeof getSavedCategories === 'function' ? getSavedCategories() : [])
      .reduce((map, c) => {
        if (c.name && c.img) map[c.name] = c.img;
        return map;
      }, {});

    if (departmentsGrid) {
      departmentsGrid.innerHTML = categories.map((category) => {
        const matching = visibleCourses.filter((course) => (course.category || "General") === category);
        const img = savedCategoryImages[category]
          || categoryImages[category]
          || 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=600&q=80';
        return `
          <article class="department-card" data-category="${category.replace(/"/g, '&quot;')}">
            <img src="${img}" alt="${category}" data-category="${category.replace(/"/g, '&quot;')}">
            <div class="department-card-content">
              <h3>${category}</h3>
              <p>${matching.length} courses available for ${category.toLowerCase()}.</p>
              <button class="btn btn-explore" type="button" data-category="${category}">Explore</button>
            </div>
          </article>
        `;
      }).join("");

      departmentsGrid.querySelectorAll(".btn-explore").forEach((button) => {
        button.addEventListener("click", () => {
          const category = button.dataset.category;
          if (category && typeof window.openCourseModal === "function") {
            window.openCourseModal(category);
          }
        });
      });
    }

    if (countLabel) {
      countLabel.textContent = `${getProgramCatalog().length} Courses available`;
    }

    const certificationProgramsStat = document.getElementById('certification-programs-stat');
    if (certificationProgramsStat) {
      const programCount = visibleCourses.length;
      const previousCount = Number(certificationProgramsStat.dataset.count) || 0;
      const alreadyAnimated = certificationProgramsStat.dataset.countAnimated === 'true';
      certificationProgramsStat.dataset.count = String(programCount);
      certificationProgramsStat.dataset.suffix = '';
      // Play the same count-up animation used for "Passing Score to Certify"
      // and "Online & Self-Paced" — always on the very first render (so the
      // page never shows a placeholder number without the count-up effect,
      // even when the real count happens to match the placeholder), and
      // again any time the real number changes afterward (course added or
      // removed). Skip re-animating on a background refresh where nothing
      // actually changed.
      if ((!alreadyAnimated || previousCount !== programCount) && typeof animateCount === 'function') {
        animateCount(certificationProgramsStat);
        certificationProgramsStat.dataset.countAnimated = 'true';
      } else {
        certificationProgramsStat.textContent = String(programCount);
      }
    }

    const programCountEyebrow = document.getElementById('programCountEyebrow');
    if (programCountEyebrow) {
      const programCount = visibleCourses.length;
      programCountEyebrow.textContent = `🎓 ${programCount} Certification-Ready Program${programCount === 1 ? '' : 's'}`;
    }

    // Populate filter select with the same categories list
    if (filter) {
      const opts = ['All', ...categories];
      filter.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join('');
    }

    // Keep the "Industry Categories" stat in the hero strip in sync with
    // the real number of categories (this used to be a hardcoded "5", so
    // uploading a course in a new category never showed up here even
    // though the department cards below it were already correct).
    const industryStat = document.getElementById('industry-categories-stat');
    if (industryStat) {
      const previousCategoryCount = Number(industryStat.dataset.count) || 0;
      const alreadyAnimatedCategories = industryStat.dataset.countAnimated === 'true';
      industryStat.dataset.count = String(categories.length);
      // Same count-up treatment as the stat above — always animate on the
      // first render (even if the real category count happens to match the
      // "5" placeholder that used to be hardcoded here), then only replay
      // it later if the number actually changes.
      if ((!alreadyAnimatedCategories || previousCategoryCount !== categories.length) && typeof animateCount === 'function') {
        animateCount(industryStat);
        industryStat.dataset.countAnimated = 'true';
      } else {
        industryStat.textContent = String(categories.length);
      }
    }
    // departmentsGrid.innerHTML above just rebuilt every department card
    // from scratch using the default categoryImages/text, discarding any
    // saved Edit Mode image/text override that was previously showing.
    // Re-apply saved overrides now, the same way the home page's
    // renderHomePrograms()/reapplyHomeOverrides() already does for its
    // "Programs Overview" cards — otherwise a department card image edited
    // here shows correctly for a moment, then reverts to the default a few
    // seconds later whenever this function re-runs (e.g. once Firestore
    // data finishes loading, or a category/course changes elsewhere).
    try {
      if (typeof applyContentOverrides === "function") applyContentOverrides("programs");
    } catch (error) {
      console.warn("Failed to re-apply overrides after rendering departments", error);
    }
  };

  const renderProgramCourses = () => {
    if (!grid) return;

    const query = (search?.value || "").toLowerCase();
    const selected = filter?.value || "All";
    const auth = getAuth();

    const filtered = getProgramCatalog().filter((course) => {
      const textValues = [course.title, course.description, course.category, course.level, course.duration].filter(Boolean);
      const matchesQuery = textValues.some((value) => value.toLowerCase().includes(query));
      const categoryMatches = !activeCategory || (course.category || "General") === activeCategory;
      const matchesFilter = selected === "All" || course.category === selected;
      return matchesQuery && categoryMatches && matchesFilter;
    });

    const orderedCourses = [...filtered].sort((a, b) => {
      const aPriority = a.accessRule === "free" ? 0 : 1;
      const bPriority = b.accessRule === "free" ? 0 : 1;
      return aPriority - bPriority;
    });

    grid.innerHTML = orderedCourses.length
      ? orderedCourses
          .map(
            (course) => {
              const isFree = course.accessRule === 'free' || course.accessRule === 'paid'
                ? course.accessRule === 'free'
                : (course.level && course.level.toLowerCase() === 'beginner');
              const buttonText = isFree ? 'Enroll Now →' : 'Pay to Enroll →';
              const titleEscaped = (course.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
              const categoryEscaped = (course.category || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
              const onClickHandler = isFree 
                ? `handleEnrollClick('${titleEscaped}', '${categoryEscaped}')`
                : `handlePayClick('${titleEscaped}', '${categoryEscaped}')`;
              return `
              <article class="course-card category-${(course.category || 'general').replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}" data-course-title="${escapeHtml(course.title)}">
                ${course.img ? `<img src="${course.img}" alt="${course.title}" class="course-card-image" data-course-title="${escapeHtml(course.title)}" />` : ''}
                <div class="course-card-content">
                  <h3>${course.title}</h3>
                  <p>${course.description}</p>
                  <button class="btn btn-primary" type="button" onclick="${onClickHandler}">${buttonText}</button>
                </div>
              </article>
            `;
            }
          )
          .join("")
      : '<p class="form-note">No courses match your search yet.</p>';
    // Same reasoning as the departments grid above: this just rebuilt every
    // course card from scratch, so re-apply any saved (non-image) overrides
    // targeting elements inside this grid (e.g. course title/description
    // text edited via Edit Mode). Course thumbnail images are unaffected —
    // they're already re-read from course.img on every render — but text
    // overrides use the generic selector-based system and would otherwise
    // revert the same way the department card image did.
    try {
      if (typeof applyContentOverrides === "function") applyContentOverrides("programs");
    } catch (error) {
      console.warn("Failed to re-apply overrides after rendering course cards", error);
    }
  };

  const openProgramCategory = (category) => {
    activeCategory = category;
    const modal = document.getElementById("courseModal");
    const title = document.getElementById("courseModalTitle");
    if (title) {
      title.textContent = `${category} Courses`;
    }
    if (modal) {
      modal.hidden = false;
      document.body.style.overflow = "hidden";
    }
    renderProgramCourses();
  };

  window.openCourseModal = openProgramCategory;

  // Close course modal functionality
  const courseModal = document.getElementById("courseModal");
  const closeModalBtn = courseModal?.querySelector(".close-modal-btn");
  const modalBackdrop = courseModal?.querySelector(".course-modal-backdrop");

  const closeCourseModal = () => {
    if (courseModal) {
      courseModal.hidden = true;
      document.body.style.overflow = "auto";
      activeCategory = null;
    }
    if (filter) filter.value = "All";
  };

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeCourseModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", closeCourseModal);
  }

  // Close modal on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && courseModal && !courseModal.hidden) {
      closeCourseModal();
    }
  });

  search?.addEventListener("input", renderProgramCourses);
  filter?.addEventListener("change", () => {
    const selected = filter.value;
    if (selected && selected !== "All") {
      openProgramCategory(selected);
    } else {
      activeCategory = null;
      closeCourseModal();
      renderProgramCourses();
    }
  });
  renderProgramsOverview();
  renderProgramCourses();
  window.renderCourses = renderProgramCourses;
  window.renderDepartments = renderProgramsOverview;

  if (window.dataReadyPromise) {
    window.dataReadyPromise.then(() => {
      renderProgramsOverview();
      renderProgramCourses();
    }).catch((err) => console.error('Failed to refresh programs after data load', err));
  }

  // Categories now stream in live (see watchCategories()), so a category
  // uploaded from another page/tab (or by another instructor/admin) shows
  // up here right away, without the visitor needing to leave and return.
  document.addEventListener('categories:updated', () => {
    renderProgramsOverview();
    renderProgramCourses();
  });
  // Courses now stream in live too (see watchCourses()), so a freshly
  // uploaded course (e.g. Civil Engineering) shows up here right away.
  document.addEventListener('courses:updated', () => {
    renderProgramsOverview();
    renderProgramCourses();
  });

  const schedule = document.getElementById("exam-schedule");
  if (schedule) {
    schedule.textContent = isAuthenticated()
      ? "No exams are scheduled yet. Please check back soon for certification dates."
      : "Sign in to view upcoming certification exam dates.";
  }
}

if (page === "login") {
  const cameFromAdminEditMode = new URLSearchParams(window.location.search).get("from") === "admin";

  const redirectIfAuthed = () => {
    if (isAuthenticated()) {
      const auth = getAuth();
      // Admins are only kept on the login page when they intentionally
      // arrived via the admin panel's Edit Mode link (login.html?from=admin)
      // — that's the one case where they need this page's own inline
      // editing tools. Otherwise an admin who just opens the login page
      // normally should be redirected to their dashboard like anyone else.
      if (auth.role !== "admin" || !cameFromAdminEditMode) {
        window.location.replace(getPostAuthHref(auth.role));
        return true;
      }
    }
    return false;
  };

  // Check immediately first: currentUser is already populated synchronously
  // above (from the cached session snapshot) by the time this line runs, so
  // in the common case — a visitor who is genuinely still logged in — this
  // redirects right away with no visible flash of the login form at all.
  // Only fall back to waiting for the real, confirmed Firebase check
  // (authReadyPromise) when the cache came up empty, e.g. no session was
  // cached yet on this browser but one still turns out to exist.
  if (!redirectIfAuthed()) {
    authReadyPromise.then(redirectIfAuthed);
  }

  const form = document.getElementById("login-form");
  bindLoginForm();
  bindForgotPasswordForms();

  if (isAdmin() && form) {
    const adminHint = document.createElement('p');
    adminHint.className = 'form-note success';
    adminHint.textContent = 'Admin users can edit content from the admin panel after login.';
    form.parentNode?.insertBefore(adminHint, form.nextSibling);
  }
}

if (page === "forgot-password") {
  bindForgotPasswordForms();
}

if (page === "dashboard") {
  bindChangePasswordForm();
  const authProfile = getAuth();
  const welcome = document.getElementById("dashboard-welcome");
  const logoutButton = document.getElementById("logout-button");
  const adminPanelAction = document.getElementById("admin-panel-action");

  if (!authProfile) {
    window.location.href = "login.html";
    return;
  }
  if (authProfile.role === "admin" || authProfile.role === "instructor") {
    window.location.href = getPortalHref(authProfile.role);
    return;
  }

  const tabs = Array.from(document.querySelectorAll('.dashboard-tab'));
  const panels = Array.from(document.querySelectorAll('.dashboard-panel-card[data-panel="tabbed"]'));
  const showPanel = (selector) => {
    panels.forEach((p) => {
      p.classList.add('hidden');
      p.setAttribute('hidden', '');
    });
    const target = document.querySelector(selector);
    if (target && target.dataset.panel === 'tabbed') {
      target.classList.remove('hidden');
      target.removeAttribute('hidden');
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const target = tab.dataset.target || null;
      if (target) {
        showPanel(target);
        if (target === '#achievements-panel') {
          const grid = document.getElementById('achievements-grid');
          if (grid) {
            // re-render existing certificates (script already populates on load)
          }
        }
      }
    });
  });

  (function initActivePanel() {
    const hash = window.location.hash;

    if (hash) {
      // Direct match: the hash points straight at a tab's panel (e.g. from
      // the nav dropdown's "Certificates" or "Learning History" links).
      const matchingTab = tabs.find((t) => t.dataset.target === hash);
      if (matchingTab) {
        matchingTab.click();
        return;
      }

      // Indirect match: the hash points at something nested inside a tabbed
      // panel (e.g. "Settings" links to #change-password-form). Activate
      // that panel's tab, then scroll to the specific element.
      const el = document.querySelector(hash);
      if (el) {
        const panel = el.closest('.dashboard-panel-card[data-panel="tabbed"]');
        const tabForPanel = panel ? tabs.find((t) => t.dataset.target === `#${panel.id}`) : null;
        if (tabForPanel) tabForPanel.click();
        requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        return;
      }
    }

    const active = document.querySelector('.dashboard-tab.is-active');
    const target = active?.dataset?.target || '#profile-panel';
    showPanel(target);
  })();

  // Render immediately with whatever's already cached (seeded synchronously
  // from localStorage at script load — see ENROLLMENTS_SNAPSHOT_KEY /
  // CERTIFICATES_SNAPSHOT_KEY above) instead of blocking on a full
  // Firestore round trip here. That blocking `await window.dataReadyPromise`
  // used to gate this entire panel — profile fields, tabs, stats,
  // achievements, learning history — on the network, which is what
  // produced the visible delay before anything showed up on initial load
  // and on every refresh. The certificates UI already self-corrects once
  // real data arrives (see certificatesReadyPromise/onCertsUpdated below);
  // refreshUserEnrollments() (added further down) does the same for
  // enrollment-derived UI once watchEnrollments()'s realtime listener
  // reports back.
  let userEnrolls = getUserEnrollmentHistory(authProfile.email);
  let certificates = getUserCertificates(authProfile.email);

  const parseCertificateExpiry = (certificate) => {
    const expiryValue = certificate.expiryDate || certificate.expiresAt || certificate.expiry || certificate.expiry_date || "";
    let expiryDate = expiryValue ? new Date(expiryValue) : null;
    if (!expiryDate || Number.isNaN(expiryDate.getTime())) {
      const issued = certificate.issuedAt ? new Date(certificate.issuedAt) : (certificate.date ? new Date(certificate.date) : null);
      if (issued && !Number.isNaN(issued.getTime())) {
        expiryDate = new Date(issued);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      }
    }
    return expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null;
  };

  const formatDashboardDate = (date) => {
    if (!date) return "Unknown";
    try {
      return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return String(date);
    }
  };

  const expiringCertificates = (certificates || [])
    .map((cert) => {
      const expiryDate = parseCertificateExpiry(cert);
      if (!expiryDate) return null;
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
      return {
        title: cert.course || cert.title || 'Untitled Course',
        expiryDate,
        daysUntilExpiry,
        status: daysUntilExpiry < 0 ? 'Expired' : daysUntilExpiry <= 30 ? 'Expiring soon' : 'Active'
      };
    })
    .filter(Boolean)
    .filter((cert) => cert.daysUntilExpiry <= 30)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const userNotificationsButton = document.getElementById('user-notifications-button');
  const showUserNotifications = () => {
    const title = document.getElementById('dashboard-modal-title');
    const content = document.getElementById('dashboard-modal-content');
    const dashboardModal = document.getElementById('dashboard-modal');
    if (!title || !content || !dashboardModal) return;

    title.textContent = 'Certificate Alerts';
    if (!expiringCertificates.length) {
      content.innerHTML = `<p class="form-note">You have no certificates expiring in the next 30 days.</p>`;
    } else {
      content.innerHTML = `
        <div class="dashboard-notifications-list">
          ${expiringCertificates.map((cert) => `
            <div class="dashboard-notification-item">
              <h4>${escapeHtml(cert.title)}</h4>
              <p class="form-note">Expires on <strong>${escapeHtml(formatDashboardDate(cert.expiryDate))}</strong> (${cert.daysUntilExpiry} day${cert.daysUntilExpiry === 1 ? '' : 's'} left)</p>
            </div>
          `).join('')}
        </div>
      `;
    }

    dashboardModal.classList.remove('hidden');
  };

  if (userNotificationsButton) {
    const count = expiringCertificates.length;
    userNotificationsButton.textContent = '🔔';
    userNotificationsButton.setAttribute('aria-label', count > 0 ? `${count} certificates expiring soon` : 'Notifications');
    userNotificationsButton.classList.toggle('notification-alert', count > 0);
    userNotificationsButton.addEventListener('click', showUserNotifications);
  }

  if (welcome) {
    if (welcome) {
      welcome.textContent = `Welcome back, ${authProfile.name.split(" ")[0]}!`;
    }

    const profilePhone = document.getElementById("contact-number");
    const dashboardContactNumber = document.getElementById("dashboard-contact-number");
    const profileFirstName = document.getElementById("first-name");
    const profileLastName = document.getElementById("last-name");
    const profileEmailAddress = document.getElementById("email-address");
    const profileForm = document.getElementById("basic-info-form");
    const basicInfoNote = document.getElementById("basic-info-note");
    const dashboardAvatar = document.getElementById("dashboard-avatar");
    const profileImageInput = document.getElementById("profile-image-input");

    const setDashboardProfile = () => {
      const activeUser = getAuth();
      const fullName = activeUser?.name?.trim() || (activeUser?.email ? activeUser.email.split("@")[0] : "Learner");
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const initials = nameParts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
      const photoUrl = activeUser?.photoURL || getStoredProfilePhoto(activeUser?.uid) || "";
      const contactNumber = activeUser?.contact || (activeUser?.uid ? getUserContact(activeUser.uid) : "");

          const dashboardGreeting = document.querySelector('.dashboard-profile-welcome');
      if (dashboardGreeting) dashboardGreeting.textContent = "Welcome back,";
      if (welcome) welcome.textContent = firstName || "Learner";
      if (dashboardAvatar) {
        dashboardAvatar.textContent = photoUrl ? "" : initials;
        dashboardAvatar.style.backgroundImage = photoUrl ? `url('${photoUrl}')` : "";
        dashboardAvatar.style.backgroundSize = photoUrl ? "cover" : "";
        dashboardAvatar.style.backgroundPosition = photoUrl ? "center" : "";
        dashboardAvatar.style.color = photoUrl ? "transparent" : "";
      }
      if (profileFirstName) profileFirstName.value = firstName;
      if (profileLastName) profileLastName.value = lastName;
      if (profileEmailAddress) profileEmailAddress.value = activeUser?.email || "";
      if (profilePhone) profilePhone.value = contactNumber;
      if (dashboardContactNumber) dashboardContactNumber.textContent = contactNumber || "Add your contact number";
    };

    setDashboardProfile();

    if (dashboardAvatar && profileImageInput) {
      dashboardAvatar.addEventListener("click", () => profileImageInput.click());
      dashboardAvatar.style.cursor = "pointer";
      dashboardAvatar.title = "Change profile photo";
    }

    if (profileForm && profileForm.dataset.bound !== "true") {
      profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const activeUser = getAuth();
        const firstNameValue = profileFirstName?.value.trim() || "";
        const lastNameValue = profileLastName?.value.trim() || "";
        const nextName = [firstNameValue, lastNameValue].filter(Boolean).join(" ") || activeUser?.email?.split("@")[0] || "Learner";
        const nextContact = profilePhone?.value.trim() || "";

        if (!firstNameValue) {
          setFormNote(basicInfoNote, "Please enter your first name.", "error");
          return;
        }

        const submitButton = profileForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        try {
          const firebaseUser = auth?.currentUser || null;
          if (firebaseUser && firebaseUser.displayName !== nextName) {
            await updateProfile(firebaseUser, { displayName: nextName });
          }

          if (activeUser?.uid) {
            saveUserContact(activeUser.uid, nextContact); // local cache fallback
          }
          if (activeUser?.email) {
            await saveUserProfileFields(activeUser.email, { contact: nextContact });
          }

          currentUser = {
            ...(currentUser || {}),
            name: nextName,
            email: activeUser?.email || currentUser?.email || "",
            contact: nextContact
          };

          setDashboardProfile();
          updateHeaderAuthLink();
          setFormNote(basicInfoNote, "Profile updated successfully.", "success");
        } catch (error) {
          console.error("Failed to update profile", error);
          setFormNote(basicInfoNote, "We couldn't save your profile right now.", "error");
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });

      profileForm.dataset.bound = "true";
    }

    const changeEmailLink = document.querySelector('.contact-change-email');
    if (changeEmailLink && changeEmailLink.dataset.bound !== 'true') {
      changeEmailLink.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!basicInfoNote) return;
        basicInfoNote.textContent = "";

        const activeUser = auth?.currentUser || getAuth();
        if (!activeUser || !activeUser.email) {
          setFormNote(basicInfoNote, "Please sign in again before changing your email.", "error");
          return;
        }

        const nextEmailRaw = window.prompt("Enter your new email address", activeUser.email);
        if (!nextEmailRaw) return;

        const nextEmail = nextEmailRaw.trim().toLowerCase();
        if (!validateGmail(nextEmail)) {
          setFormNote(basicInfoNote, "Enter a valid email address.", "error");
          return;
        }
        if (nextEmail === activeUser.email.toLowerCase()) {
          setFormNote(basicInfoNote, "This is already your current email address.", "error");
          return;
        }
        if (nextEmail === ADMIN_EMAIL) {
          setFormNote(basicInfoNote, "This email address is reserved. Please choose a different one.", "error");
          return;
        }

        const currentPassword = window.prompt("Enter your current password to confirm this change");
        if (!currentPassword) return;

        const previousEmail = activeUser.email.toLowerCase();
        const submitButton = profileForm?.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        try {
          const credential = EmailAuthProvider.credential(activeUser.email, currentPassword);
          await reauthenticateWithCredential(activeUser, credential);
          await updateEmail(activeUser, nextEmail);

          await syncUserProfile(activeUser, currentUser?.role || "user", activeUser.displayName || "");
          if (previousEmail && previousEmail !== nextEmail) {
            await deleteDoc(doc(db, "users", previousEmail)).catch(() => {});
          }

          currentUser = {
            ...(currentUser || {}),
            email: nextEmail
          };
          setDashboardProfile();
          updateHeaderAuthLink();
          saveLastUserSnapshot(currentUser);
          setFormNote(basicInfoNote, "Email address updated successfully.", "success");
        } catch (error) {
          const message = describeAuthError(error);
          setFormNote(basicInfoNote, message, "error");
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
      changeEmailLink.dataset.bound = 'true';
    }

    // --- Dashboard tab switching ---
    const tabs = Array.from(document.querySelectorAll('.dashboard-tab'));
    const panels = Array.from(document.querySelectorAll('.dashboard-panel-card[data-panel="tabbed"]'));
    const showPanel = (selector) => {
      panels.forEach((p) => {
        p.classList.add('hidden');
        p.setAttribute('hidden', '');
      });
      const target = document.querySelector(selector);
      if (target && target.dataset.panel === 'tabbed') {
        target.classList.remove('hidden');
        target.removeAttribute('hidden');
      }
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        tabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const target = tab.dataset.target || null;
        if (target) {
          showPanel(target);
          if (target === '#achievements-panel') {
            const grid = document.getElementById('achievements-grid');
            if (grid) {
              // re-render existing certificates (script already populates on load)
            }
          }
        }
      });
    });

    // Show only the initially-active panel on page load
    (function initActivePanel() {
      const hash = window.location.hash;

      if (hash) {
        const matchingTab = tabs.find((t) => t.dataset.target === hash);
        if (matchingTab) {
          matchingTab.click();
          return;
        }

        const el = document.querySelector(hash);
        if (el) {
          const panel = el.closest('.dashboard-panel-card[data-panel="tabbed"]');
          const tabForPanel = panel ? tabs.find((t) => t.dataset.target === `#${panel.id}`) : null;
          if (tabForPanel) tabForPanel.click();
          requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          return;
        }
      }

      const active = document.querySelector('.dashboard-tab.is-active');
      const target = active?.dataset?.target || '#profile-panel';
      showPanel(target);
    })();

    // Populate Learning History panel. Wrapped in a function (instead of a
    // one-shot block) so refreshUserEnrollments() further below can re-run
    // it once the realtime enrollments listener reports back, without
    // needing to re-bind any event handlers.
    const learningList = document.getElementById('learning-history-list');
    const renderLearningHistoryPanel = () => {
      if (!learningList) return;
      const historyEntries = (Array.isArray(userEnrolls) ? userEnrolls : []).filter(
        (entry) => (entry.status || '').toLowerCase().includes('completed')
      );

      if (!historyEntries.length) {
        learningList.innerHTML = `
          <div class="learning-history-empty">
            <h4>Learning History</h4>
            <p>No completed courses yet. Finish a course to see it here.</p>
          </div>
        `;
      } else {
        learningList.innerHTML = `<ul class="learning-history-list">${historyEntries.map((entry) => {
          const title = escapeHtml(entry.title || 'Untitled Course');
          const category = entry.category ? escapeHtml(entry.category) : 'BHF Academy';
          const courseDesc = escapeHtml(entry.courseDesc || '');
          const courseImage = entry.courseImage ? escapeHtml(entry.courseImage) : '';
          const courseType = escapeHtml(entry.courseType || 'Course');
          const duration = escapeHtml(entry.courseDuration || '');
          const level = escapeHtml(entry.courseLevel || '');
          const status = escapeHtml(entry.status || 'In progress');
          const startDate = escapeHtml(entry.startDate || entry.enrolledAt || entry.date || entry.issuedAt || 'TBD');
          const completionDate = escapeHtml(entry.completionDate || entry.date || entry.issuedAt || 'TBD');
          const statusClass = (status || '').toLowerCase().includes('completed') ? 'is-ok' : (status || '').toLowerCase().includes('in progress') ? 'is-progress' : 'is-muted';
          return `
            <li class="learning-history-item">
              <div class="learning-history-card">
                <div class="learning-history-card-left">
                  <div class="learning-history-thumb">
                    ${courseImage ? `<img src="${courseImage}" alt="${title}" />` : `<div class="learning-history-thumb-placeholder">No image</div>`}
                  </div>
                  <div class="learning-history-card-info">
                    <div class="learning-history-card-tags">
                      <span class="learning-history-card-badge">${courseType}</span>
                      <span class="learning-history-card-badge secondary">${category}</span>
                    </div>
                    <h4 class="learning-history-course-title">${title}</h4>
                    <p class="learning-history-course-desc">${courseDesc}</p>
                    <div class="learning-history-card-meta-row">
                      ${level ? `<span class="learning-history-meta-pill">${level}</span>` : ''}
                      ${duration ? `<span class="learning-history-meta-pill">${duration}</span>` : ''}
                    </div>
                  </div>
                </div>
                <div class="learning-history-card-stats">
                  <div class="learning-history-stat-row"><span>Course Start Date</span><strong>${startDate}</strong></div>
                  <div class="learning-history-stat-row"><span>Completion Date</span><strong>${completionDate}</strong></div>
                </div>
                <div class="learning-history-card-right">
                  <span class="learning-history-status-pill ${statusClass}">${status}</span>
                  <a class="btn btn-secondary learning-history-action" href="course-detail.html?course=${encodeURIComponent(entry.title || '')}">View Course</a>
                </div>
              </div>
            </li>
          `;
        }).join('')}</ul>`;
      }
    };
    renderLearningHistoryPanel();

    if (profileImageInput) {
      profileImageInput.addEventListener("change", async (event) => {
        const [file] = event.target.files || [];
        if (!file) return;

        await authReadyPromise;
        const firebaseUser = auth?.currentUser || null;
        if (!firebaseUser) {
          setFormNote(basicInfoNote, "Please sign in again before changing your photo.", "error");
          return;
        }

        const submitButton = profileForm?.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        const reader = new FileReader();
        reader.onload = async () => {
          const localPhotoUrl = reader.result;
          if (typeof localPhotoUrl !== 'string') {
            if (submitButton) submitButton.disabled = false;
            return;
          }

          saveStoredProfilePhoto(firebaseUser.uid, localPhotoUrl);
          currentUser = {
            ...(currentUser || {}),
            uid: firebaseUser.uid,
            name: currentUser?.name || firebaseUser.displayName || "",
            email: currentUser?.email || firebaseUser.email || "",
            photoURL: localPhotoUrl
          };
          setDashboardProfile();
          updateHeaderAuthLink();

          const imageName = `${firebaseUser.uid || 'guest'}-${Date.now()}-${file.name}`;
          const storageRef = ref(storage, `profile-images/${imageName}`);

          try {
            await uploadBytes(storageRef, file);
            const photoURL = await getDownloadURL(storageRef);
            await updateProfile(firebaseUser, { photoURL });
            saveStoredProfilePhoto(firebaseUser.uid, photoURL); // local cache fallback
            if (firebaseUser.email) {
              await saveUserProfileFields(firebaseUser.email, { photoURL });
            }
            currentUser = {
              ...(currentUser || {}),
              photoURL
            };
            setDashboardProfile();
            updateHeaderAuthLink();
            setFormNote(basicInfoNote, "Profile photo updated successfully.", "success");
          } catch (error) {
            console.error("Failed to upload profile photo", error);
            setFormNote(basicInfoNote, "Photo saved on this device and will appear immediately.", "success");
          } finally {
            if (submitButton) submitButton.disabled = false;
            if (profileImageInput) profileImageInput.value = "";
          }
        };
        reader.readAsDataURL(file);
      });
    }

    /* ---------- Achievements / Badges grid ---------- */
    const achievementsGrid = document.getElementById("achievements-grid");
    const certificateIconSvg = `
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="22" cy="24" r="12" stroke="currentColor" stroke-width="2.4" />
        <path d="M22 12 L24.5 18 L31 18.5 L26 22.5 L27.5 29 L22 25.5 L16.5 29 L18 22.5 L13 18.5 L19.5 18 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M16 33 L13 44 L22 40 L31 44 L28 33" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
        <line x1="38" y1="18" x2="54" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        <line x1="38" y1="26" x2="54" y2="26" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        <line x1="38" y1="34" x2="48" y2="34" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      </svg>`;

    // Renders the HTML markup for a single achievement/certificate card.
    const renderAchievementCardHtml = (cert) => {
      const catalog = getCourseCatalog ? getCourseCatalog() : [];
      const course = catalog.find((c) => normalizeCourseTitle(c.title) === normalizeCourseTitle(cert.course)) || {};
      const image = course.img || course.image || (cert.iconUrl || "") || "";
      const tag = (cert.tag || 'Certificate');
      const category = (course.category || 'COURSE').toUpperCase();
      const title = escapeHtml(cert.course || 'Untitled');
      const date = escapeHtml(cert.date || '—');
      const code = escapeHtml(cert.code || '');
      const iconHtml = image ? `<div class="achievement-icon-image"><img src="${escapeHtml(image)}" alt="${title}"/></div>` : `<div class="achievement-icon-rect">${certificateIconSvg}</div>`;

      return `
      <article class="achievement-card" data-course="${escapeHtml(cert.course)}" data-date="${escapeHtml(cert.date)}" data-code="${code}" tabindex="0" role="button" aria-label="View details for ${title}">
        <div class="achievement-card-body">
          <span class="achievement-tag">${escapeHtml(tag)}</span>
          <div class="achievement-icon">${iconHtml}</div>
          <span class="achievement-category">${escapeHtml(category)}</span>
          <h4 class="achievement-title" title="${title}">${title}</h4>
          <div class="achievement-actions"><button class="btn btn-primary" type="button" data-action="view-certificate" aria-label="View certificate for ${title}">View Certificate</button></div>
        </div>
        <div class="achievement-footer">Issued On: <strong>${date}</strong></div>
      </article>`;
    };

    /* ---------- Achievement detail modal (course info) ---------- */
    const achievementDetailModal = document.getElementById("achievement-detail-modal");
    const achievementDetailTitle = document.getElementById("achievement-detail-title");
    const achievementDetailContent = document.getElementById("achievement-detail-content");
    const achievementDetailClose = document.getElementById("achievement-detail-close");

    const openAchievementDetail = (courseTitle, issuedDate) => {
      if (!achievementDetailModal) return;
      const catalog = getCourseCatalog();
      const course = catalog.find((c) => normalizeCourseTitle(c.title) === normalizeCourseTitle(courseTitle)) || {};

      const academy = course.category || "General";
      const duration = course.duration || "4 Weeks";
      const desc = course.desc || "Continue learning and build your foundational skills.";
      const skills = Array.isArray(course.learning) && course.learning.length
        ? course.learning
        : [courseTitle];
      const courseImage = course.img || course.image || "";

      achievementDetailTitle.textContent = courseTitle;
      achievementDetailContent.innerHTML = `
        ${courseImage ? `<img src="${courseImage}" alt="${escapeHtml(courseTitle)}" class="achievement-detail-image" />` : ""}
        <div class="achievement-detail-top">
          <div class="achievement-detail-icon">${certificateIconSvg}</div>
          <div>
            <a class="achievement-detail-link" href="course-detail.html?course=${encodeURIComponent(courseTitle)}" target="_blank" rel="noopener">
              ${escapeHtml(courseTitle)}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M14 5h5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M19 5L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </a>
            <p class="achievement-detail-desc">${escapeHtml(desc)}</p>
          </div>
        </div>
        <div class="achievement-detail-stats">
          <div>
            <div class="achievement-detail-stat-label">Issued Date</div>
            <div class="achievement-detail-stat-value">${escapeHtml(issuedDate)}</div>
          </div>
          <div>
            <div class="achievement-detail-stat-label">Duration</div>
            <div class="achievement-detail-stat-value">${escapeHtml(duration)}</div>
          </div>
          <div>
            <div class="achievement-detail-stat-label">Academy</div>
            <div class="achievement-detail-stat-value">${escapeHtml(academy)}</div>
          </div>
        </div>
        <div class="achievement-detail-skills-label">Skills You Learn</div>
        <ul class="achievement-detail-skills-list">
          ${skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join("")}
        </ul>
      `;
      achievementDetailModal.classList.remove("hidden");
    };

    const closeAchievementDetail = () => {
      achievementDetailModal?.classList.add("hidden");
    };
    achievementDetailClose?.addEventListener("click", closeAchievementDetail);
    achievementDetailModal?.addEventListener("click", (e) => {
      if (e.target === achievementDetailModal) closeAchievementDetail();
    });

    /* ---------- Certificate modal (the actual certificate image) ---------- */
    const openCertificateModal = (cert) => {
      const certificateModal = document.getElementById('certificate-modal');
      const certificateModalContent = document.getElementById('certificate-modal-content');
      if (!certificateModal || !certificateModalContent || !cert) return;

      const safeName = escapeHtml((currentUser && currentUser.name) || cert.name || 'Recipient Name');
      const safeDate = escapeHtml(cert.date || '—');
      const safeCode = escapeHtml(cert.code || '');
      const safeCourse = escapeHtml(cert.course || 'Certificate');
      let expiryDate = new Date(cert.expiry || cert.date || Date.now());
      if (Number.isNaN(expiryDate.getTime())) {
        expiryDate = new Date();
      }
      if (!cert.expiry) {
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      }
      const safeExpiry = escapeHtml(expiryDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }));

      const certificateUrl = cert.certificateFileUrl || "";
      const isPdf = /^(data:application\/pdf|application\/pdf|.*\.pdf($|[?#]))/i.test(certificateUrl);
      const isImage = /^(data:image\/|https?:.*\.(png|jpe?g|svg|gif)([?#].*)?$)/i.test(certificateUrl);
      const previewHtml = certificateUrl
        ? isPdf
          ? `<div id="dashboard-certificate-image" class="verified-certificate-card"><object data="${escapeHtml(certificateUrl)}" type="application/pdf" width="100%" height="100%">Your browser does not support PDF preview. <a href="${escapeHtml(certificateUrl)}" target="_blank" rel="noopener noreferrer">Open PDF</a></object></div>`
          : isImage
            ? `<div id="dashboard-certificate-image" class="verified-certificate-card"><img src="${escapeHtml(certificateUrl)}" alt="Certificate preview" class="verified-certificate-image"/></div>`
            : `<div id="dashboard-certificate-image" class="verified-certificate-card"><iframe src="${escapeHtml(certificateUrl)}" class="verified-certificate-image" frameborder="0" allowfullscreen></iframe></div>`
        : `<div id="dashboard-certificate-image" class="verified-certificate-card"><div class="certificate-preview-missing">Certificate preview is not available.</div></div>`;

      certificateModalContent.innerHTML = `
        <div id="dashboard-certificate-card" class="verified-certificate-wrapper certificate-modal-expanded">
          <div class="certificate-modal-columns">
            <div class="certificate-modal-left">
              ${previewHtml}
            </div>
            <aside class="certificate-modal-right">
              <div class="verified-certificate-info">
                <div class="certificate-status-row">
                  <div class="certificate-status-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
                  </div>
                  <div class="certificate-status-text">
                    <p class="certificate-status-title">Certificate Verified</p>
                    <p class="certificate-status-sub">This certificate is valid and verified.</p>
                  </div>
                </div>

                <div class="certificate-detail-list">
                  <div class="certificate-detail-item">
                    <div class="certificate-detail-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </div>
                    <div class="certificate-detail-text">
                      <span class="detail-label">Date Issued</span>
                      <span class="detail-value">${safeDate}</span>
                    </div>
                  </div>
                  <div class="certificate-detail-item certificate-detail-item--id">
                    <div class="certificate-detail-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="6" y1="15" x2="10" y2="15"></line><line x1="14" y1="15" x2="18" y2="15"></line><circle cx="8" cy="10" r="1.5"></circle></svg>
                    </div>
                    <div class="certificate-detail-text certificate-detail-text--id">
                      <span class="detail-label">Certificate ID</span>
                      <div class="certificate-id-box">
                        <span class="detail-value detail-value--code" id="certificate-modal-code-text">${safeCode}</span>
                        <button type="button" class="certificate-id-copy" id="certificate-modal-copy" aria-label="Copy certificate ID">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="certificate-detail-item">
                    <div class="certificate-detail-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </div>
                    <div class="certificate-detail-text">
                      <span class="detail-label">Expiry Date</span>
                      <span class="detail-value">${safeExpiry}</span>
                    </div>
                  </div>
                </div>

                <div class="verified-certificate-actions certificate-modal-button-row">
                  <button class="btn btn-primary certificate-btn-download" id="certificate-modal-download">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>
                    Download Certificate
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      `;
      certificateModal.classList.remove('hidden');

      // Wire modal buttons. Using onclick (instead of addEventListener) so
      // re-opening the modal doesn't stack up duplicate listeners.
      const closeBtn = document.getElementById('certificate-modal-close');
      const modalBack = document.getElementById('certificate-modal-back');
      const modalDownload = document.getElementById('certificate-modal-download');
      const modalCopy = document.getElementById('certificate-modal-copy');
      const modalWrapper = document.getElementById('certificate-modal');
      if (closeBtn) closeBtn.onclick = () => modalWrapper.classList.add('hidden');
      if (modalBack) modalBack.onclick = () => modalWrapper.classList.add('hidden');
      if (modalDownload) modalDownload.onclick = () => {
        if (cert && cert.certificateFileUrl) {
          const url = cert.certificateFileUrl;
          const fileName = `certificate-${safeName.replace(/\s+/g, '-')}`;
          const extension = /data:application\/pdf|\.pdf($|[?#])/i.test(url) ? 'pdf' : 'png';
          try {
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.${extension}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } catch (e) {
            console.warn('Failed to download certificate file directly', e);
            try { window.open(url, '_blank', 'noopener,noreferrer'); }
            catch (openErr) { console.warn('Failed to open certificate file', openErr); showToast('Unable to open certificate file', 'error'); }
          }
        } else {
          showToast('Certificate file is not available for download.', 'error');
        }
      };
      if (modalCopy) {
        modalCopy.onclick = () => {
          const codeText = document.getElementById('certificate-modal-code-text')?.textContent || '';
          if (navigator.clipboard && codeText) {
            navigator.clipboard.writeText(codeText).then(() => {
              modalCopy.classList.add('is-copied');
              setTimeout(() => modalCopy.classList.remove('is-copied'), 1500);
            }).catch(() => {});
          }
        };
      }
      if (modalWrapper) {
        modalWrapper.onclick = (ev) => { if (ev.target === modalWrapper) modalWrapper.classList.add('hidden'); };
      }
    };

    // Attaches ONE set of delegated click listeners to the grid container.
    // Because these listen on the stable container (not the individual
    // cards), they keep working correctly even after the grid's innerHTML
    // is completely replaced later (e.g. once certificates finish loading
    // from Firestore). This is what previously caused "View Certificate"
    // to open the wrong (course info) modal: the re-render after Firestore
    // load re-created the cards but wired only a generic click handler
    // that ignored the button.
    let achievementsGridWired = false;
    const wireAchievementsGridOnce = (grid) => {
      if (!grid || achievementsGridWired) return;
      achievementsGridWired = true;

      grid.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('[data-action="view-certificate"]');
        const card = e.target.closest('.achievement-card');
        if (!card) return;

        const code = card.dataset.code;
        const currentCerts = getUserCertificates(authProfile.email);
        const cert = currentCerts.find((c) => String(c.code) === String(code)) || currentCerts[0] || null;

        if (viewBtn) {
          // "View Certificate" button: show the actual certificate image.
          e.stopPropagation();
          if (!cert) {
            alert('Certificate not available');
            return;
          }
          openCertificateModal(cert);
        } else {
          // Clicking elsewhere on the card: show course info detail.
          openAchievementDetail(card.dataset.course || '', card.dataset.date || '');
        }
      });

      grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.achievement-card');
        if (!card) return;
        e.preventDefault();
        openAchievementDetail(card.dataset.course || '', card.dataset.date || '');
      });
    };

    // Renders (or re-renders) the achievements grid for a given list of
    // certificates. Safe to call multiple times (e.g. once immediately,
    // then again once Firestore data has finished loading).
    const renderAchievementsGrid = (certsList) => {
      if (!achievementsGrid) return;
      if (!certsList.length) {
        achievementsGrid.innerHTML = `<p class="achievements-empty">No achievements yet. Complete a course to earn your first certificate.</p>`;
        return;
      }
      achievementsGrid.innerHTML = certsList.map(renderAchievementCardHtml).join("");
      wireAchievementsGridOnce(achievementsGrid);
    };

    // Render a single-certificate view (first certificate) for the Certificate tab
    const certificateView = document.getElementById('certificate-view');
    const renderCertificateView = (cert) => {
      if (!certificateView) return;
      if (!cert) {
        certificateView.innerHTML = '<p class="form-note">You have not earned any certificates yet.</p>';
        return;
      }
      const courseTitle = escapeHtml(cert.course || 'Certificate');
      const issued = escapeHtml(cert.date || '—');
      certificateView.innerHTML = `
        <article class="certificate-card-large">
          <span class="achievement-tag">Certificate</span>
          <div class="certificate-card-inner">
            <div class="certificate-single-icon">${certificateIconSvg}</div>
            <div class="certificate-card-text">
              <div class="certificate-category">COURSE</div>
              <h4 class="certificate-card-title">${courseTitle}</h4>
            </div>
          </div>
          <div class="certificate-card-footer">Issued On: <strong>${issued}</strong></div>
        </article>
        <div class="certificate-single-actions">
          <button class="btn btn-primary" type="button" data-action="open-first-certificate">View Certificate</button>
          <button class="btn" type="button" data-action="view-all-certificates">View all</button>
        </div>`;
    };
    if (certificateView) {
      renderCertificateView(certificates[0]);
      certificateView.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'open-first-certificate') {
          const currentCerts = getUserCertificates(authProfile.email);
          if (currentCerts[0]) {
            openCertificateModal(currentCerts[0]);
          } else {
            const firstCard = achievementsGrid?.querySelector('.achievement-card');
            if (firstCard) firstCard.click();
          }
        } else if (action === 'view-all-certificates') {
          const tab = document.querySelector('.dashboard-tab[data-target="#achievements-panel"]');
          if (tab) tab.click();
        }
      });
    }

    // Initial render (may be empty if Firestore certificates haven't loaded yet).
    renderAchievementsGrid(certificates);

    // When certificates load from Firestore, re-render the certificate UI in-place
    certificatesReadyPromise.then(() => {
      try {
        const updated = getUserCertificates(authProfile.email);
        renderAchievementsGrid(updated);
        if (certificateView) {
          try { renderCertificateView(updated[0]); } catch (err) { console.warn(err); }
        }

        const completedCount = document.getElementById('completed-count');
        const inProgressCount = document.getElementById('inprogress-count');
        const certifiedCount = document.getElementById('certified-count');
        if (completedCount) completedCount.textContent = String(updated.length);
        if (inProgressCount) inProgressCount.textContent = String(userEnrolls.length);
        if (certifiedCount) certifiedCount.textContent = String(updated.length);
      } catch (e) {
        console.warn('Error updating certificates UI after load', e);
      }
    });

    // Also re-render on realtime updates (admin uploads, etc.)
    const onCertsUpdated = () => {
      try {
        const updated = getUserCertificates(authProfile.email);
        renderAchievementsGrid(updated);
        if (certificateView) {
          try { renderCertificateView(updated[0]); } catch (err) { console.warn(err); }
        }
        const completedCount = document.getElementById('completed-count');
        const inProgressCount = document.getElementById('inprogress-count');
        const certifiedCount = document.getElementById('certified-count');
        if (completedCount) completedCount.textContent = String(updated.length);
        if (inProgressCount) inProgressCount.textContent = String(userEnrolls.length);
        if (certifiedCount) certifiedCount.textContent = String(updated.length);
      } catch (err) { console.warn('Error handling certificates:updated', err); }
    };
    document.addEventListener('certificates:updated', onCertsUpdated);

    // Enrollment-derived UI (Learning History panel, "in progress" count,
    // and the dashboard modal's enrollment list, which all read the
    // `userEnrolls` variable) started this render from whatever was
    // already cached in enrollmentsCache — possibly stale or empty on a
    // brand-new browser with no prior snapshot. Once watchEnrollments()'s
    // realtime listener reports back (or dataReadyPromise resolves, for
    // the very first load), recompute `userEnrolls` and re-render the
    // panels that depend on it, the same way onCertsUpdated does above for
    // certificates.
    const refreshUserEnrollments = () => {
      try {
        userEnrolls = getUserEnrollmentHistory(authProfile.email);
        renderLearningHistoryPanel();
        const inProgressCount = document.getElementById('inprogress-count');
        if (inProgressCount) inProgressCount.textContent = String(userEnrolls.length);
      } catch (err) { console.warn('Error refreshing enrollment UI', err); }
    };
    if (window.dataReadyPromise) window.dataReadyPromise.then(refreshUserEnrollments);
    document.addEventListener('enrollments:updated', refreshUserEnrollments);

    // Notify the logged-in user when they receive a new certificate.
    // Maintain a per-user in-memory set of known certificate IDs so we
    // only show toasts for newly-arrived certificates (not on initial load).
    window._knownUserCertificates = window._knownUserCertificates || {};
    document.addEventListener('certificates:updated', () => {
      try {
        const authProfile = getAuth();
        if (!authProfile || !authProfile.email) return;
        const email = (authProfile.email || '').trim().toLowerCase();
        const current = getUserCertificates(email) || [];
        const prev = window._knownUserCertificates[email];
        if (!prev) {
          // First-time population — don't notify, just remember current set
          window._knownUserCertificates[email] = new Set(current.map((c) => c.id));
          return;
        }
        const newCerts = current.filter((c) => !prev.has(c.id));
        if (newCerts.length) {
          newCerts.forEach((cert) => {
            try {
              const title = cert.course || cert.name || 'a course';
              showToast(`New certificate issued for ${title}. Check your achievements.`, 'success');
            } catch (e) { console.warn('Failed to show certificate toast', e); }
          });
        }
        // Update known set
        window._knownUserCertificates[email] = new Set(current.map((c) => c.id));
      } catch (err) {
        console.warn('student certificate notification handler failed', err);
      }
    });

    const completedCount = document.getElementById("completed-count");
    const inProgressCount = document.getElementById("inprogress-count");
    const certifiedCount = document.getElementById("certified-count");

    if (completedCount) {
      completedCount.textContent = String(certificates.length);
    }
    if (inProgressCount) {
      inProgressCount.textContent = String(userEnrolls.length);
    }
    if (certifiedCount) {
      certifiedCount.textContent = String(certificates.length);
    }

    if (isAdmin() && adminPanelAction) {
      adminPanelAction.classList.remove("hidden");
      adminPanelAction.innerHTML = `
        <div>
          <span class="admin-cta-eyebrow">Admin access</span>
          <h3>Manage courses, programs, and certificates</h3>
          <p>You're signed in as an administrator. Head to the admin editor to add courses or update program content.</p>
        </div>
        <a class="btn btn-primary" href="admin.html">Go to Admin Editor</a>
      `;
    }

    logoutButton?.addEventListener("click", () => {
      clearAuth();
      window.location.href = "login.html";
    });

    /* ---------- Dashboard metric card modals ---------- */
    const dashboardModal = document.getElementById("dashboard-modal");
    const dashboardModalTitle = document.getElementById("dashboard-modal-title");
    const dashboardModalContent = document.getElementById("dashboard-modal-content");
    const dashboardModalClose = document.getElementById("dashboard-modal-close");

    const openDashboardModal = (type) => {
      if (!dashboardModal) return;

      if (type === "certifications") {
        dashboardModalTitle.textContent = "Your Certificates";
        if (!certificates.length) {
          dashboardModalContent.innerHTML = `<p class="form-note">You haven't earned any certificates yet. Pass a course exam to earn one.</p>`;
        } else {
          dashboardModalContent.innerHTML = `<ul class="dashboard-modal-list">${certificates.map((cert) => `
            <li class="dashboard-modal-list-item">
              <div>
                <strong>${escapeHtml(cert.course)}</strong>
                <p class="form-note">ID ${escapeHtml(cert.code)} &middot; ${escapeHtml(cert.date)}</p>
              </div>
              <a class="btn btn-primary" href="course-detail.html?course=${encodeURIComponent(cert.course)}&view=certificate">View Certificate</a>
            </li>`).join("")}</ul>`;
        }
      } else if (type === "completed") {
        dashboardModalTitle.textContent = "Completed Courses";
        if (!certificates.length) {
          dashboardModalContent.innerHTML = `<p class="form-note">No completed courses yet.</p>`;
        } else {
          dashboardModalContent.innerHTML = `<ul class="dashboard-modal-list">${certificates.map((cert) => `
            <li class="dashboard-modal-list-item">
              <div><strong>${escapeHtml(cert.course)}</strong></div>
              <a class="btn btn-secondary" href="course-detail.html?course=${encodeURIComponent(cert.course)}">Open Course</a>
            </li>`).join("")}</ul>`;
        }
      } else if (type === "in-progress") {
        dashboardModalTitle.textContent = "Courses In Progress";
        if (!userEnrolls.length) {
          dashboardModalContent.innerHTML = `<p class="form-note">No courses in progress yet. Explore the programs page to enroll.</p>`;
        } else {
          dashboardModalContent.innerHTML = `<ul class="dashboard-modal-list">${userEnrolls.map((enrollment) => {
            const title = typeof enrollment === 'string'
              ? enrollment
              : (enrollment?.title || enrollment?.course || String(enrollment || 'Untitled Course'));
            return `
            <li class="dashboard-modal-list-item">
              <div><strong>${escapeHtml(title)}</strong></div>
              <a class="btn btn-secondary" href="course-detail.html?course=${encodeURIComponent(title)}">Continue</a>
            </li>`;
          }).join("")}</ul>`;
        }
      } else {
        return;
      }

      dashboardModal.classList.remove("hidden");
    };

    const closeDashboardModal = () => {
      dashboardModal?.classList.add("hidden");
    };

    document.querySelectorAll("[data-modal]").forEach((btn) => {
      btn.addEventListener("click", () => openDashboardModal(btn.dataset.modal));
    });
    dashboardModalClose?.addEventListener("click", closeDashboardModal);
    dashboardModal?.addEventListener("click", (e) => {
      if (e.target === dashboardModal) closeDashboardModal();
    });
    // Actions in certificate view
    document.querySelectorAll('[data-action="open-first-certificate"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const firstCard = document.querySelector('#achievements-grid .achievement-card');
        if (firstCard) firstCard.click();
        else openDashboardModal('certifications');
      });
    });
    document.querySelectorAll('[data-action="view-learning-history"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = document.querySelector('.dashboard-tab[data-target="#learning-history-panel"]');
        if (tab) tab.click();
      });
    });
  }
}

if (page === "admin") {
  const auth = getAuth();
  const isLocalPreview = window.location.protocol === "file:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (!isLocalPreview && !auth) {
    window.location.href = "login.html";
    return;
  }

  if (!isLocalPreview && !isAdmin()) {
    window.location.href = "dashboard.html";
    return;
  }

  // Optimistic render: populate admin stat cards immediately from any
  // available in-memory caches or localStorage so the UI doesn't show
  // zeros while remote reads complete.
  (function renderAdminStatsFromCache() {
    try {
      const elUsers = document.getElementById('adx-stat-users');
      const elInstructors = document.getElementById('adx-stat-instructors');
      const elCourses = document.getElementById('adx-stat-courses');
      const elQuizzes = document.getElementById('adx-stat-quizzes');
      const elCerts = document.getElementById('adx-stat-certificates');
      const elEnrolls = document.getElementById('adx-stat-enrollments');

      // In-memory caches populated by background loaders (may be empty)
      const instructorsCount = (typeof instructorsCache !== 'undefined' && Array.isArray(instructorsCache)) ? instructorsCache.length : (typeof getInstructors === 'function' ? getInstructors().length : 0);
      const coursesCount = (typeof coursesCache !== 'undefined' && Array.isArray(coursesCache)) ? coursesCache.length : (typeof getCourseCatalog === 'function' ? getCourseCatalog().length : 0);
      const certsCount = (typeof certificatesCache !== 'undefined' && Array.isArray(certificatesCache)) ? certificatesCache.length : (typeof getCertificates === 'function' ? getCertificates().length : 0);
      const enrollmentsLocal = (function() {
        if (typeof enrollmentsCache !== 'undefined' && Array.isArray(enrollmentsCache) && enrollmentsCache.length) return enrollmentsCache.length;
        try {
          const raw = safeGetStorage(ENROLLMENT_STORE_KEY);
          if (!raw) return 0;
          const parsed = JSON.parse(raw);
          return Object.values(parsed).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        } catch { return 0; }
      })();

      if (elInstructors) elInstructors.textContent = String(instructorsCount || 0);
      if (elCourses) elCourses.textContent = String(coursesCount || 0);
      if (elCerts) elCerts.textContent = String(certsCount || 0);
      if (elEnrolls) elEnrolls.textContent = String(enrollmentsLocal || 0);

      // Quizzes count is harder to snapshot without a cache; leave as-is
      // if not available. If a global `QUESTION_BANK` or similar exists,
      // it could be used here.
    } catch (e) {
      console.warn('renderAdminStatsFromCache failed', e);
    }
  })();

  {
    const adminForm = document.getElementById("admin-form");
    const pageSelect = document.getElementById("admin-page");
    const selectorInput = document.getElementById("admin-selector");
    const contentTypeSelect = document.getElementById("admin-content-type");
    const contentInput = document.getElementById("admin-content");
    const saveButton = document.getElementById("admin-save");
    const removeButton = document.getElementById("admin-remove");
    const clearButton = document.getElementById("admin-clear");
    const overridesList = document.getElementById("admin-overrides");
    const adminNote = document.getElementById("admin-note");
    const templateForm = document.getElementById("template-form");
    const templateTitle = document.getElementById("template-title");
    const templateSubtitle = document.getElementById("template-subtitle");
    const templateNoteInput = document.getElementById("template-note-text");
    const templateProgramLabel = document.getElementById("template-program-label");
    const templateProgramMeta = document.getElementById("template-program-meta");
    const templateSignatory = document.getElementById("template-signatory");
    const templateStatus = document.getElementById("template-form-note");
      const materialsForm = document.getElementById('materials-form');
      const courseSelect = document.getElementById('admin-course-select');
      const materialsFileInput = document.getElementById('admin-course-material-file');
      const materialsNote = document.getElementById('materials-note');

    const loadTemplateForm = () => {
      if (!templateTitle) return;
      const template = getCertificateTemplate();
      templateTitle.value = template.title;
      templateSubtitle.value = template.subtitle;
      templateNoteInput.value = template.note;
      templateProgramLabel.value = template.programLabel;
      templateProgramMeta.value = template.programMeta;
      templateSignatory.value = template.signatory;
      if (templateStatus) {
        templateStatus.textContent = "Loaded current certificate template.";
        templateStatus.className = "form-note success";
      }
    };

    const showTemplateStatus = (message, type = "success") => {
      if (!templateStatus) return;
      templateStatus.textContent = message;
      templateStatus.className = `form-note ${type}`;
    };

    const renderOverrides = () => {
    const overrides = getContentOverrides();
    const selectedPage = pageSelect?.value || "home";
    const pageOverrides = overrides[selectedPage] || {};

    if (!overridesList) return;
    overridesList.innerHTML = Object.keys(pageOverrides).length
      ? Object.entries(pageOverrides)
          .map(([selector, entry]) => {
            const displayValue = entry?.type === "image"
              ? `Image URL: ${entry.value}`
              : `${entry?.value}`;
            return `
              <div class="override-item">
                <strong>${selector}</strong>
                <p>${displayValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                <button type="button" data-selector="${selector}">Edit</button>
                <button type="button" data-remove-selector="${selector}">Remove</button>
              </div>
            `;
          })
          .join("")
      : '<p class="form-note">No saved overrides for this page yet.</p>';
  };

  const showAdminNote = (message, type = "success") => {
    if (!adminNote) return;
    adminNote.textContent = message;
    adminNote.className = `form-note ${type}`;
  };

  pageSelect?.addEventListener("change", renderOverrides);

  saveButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    const targetPage = pageSelect?.value || "home";
    const selector = selectorInput?.value.trim();
    const contentType = contentTypeSelect?.value || "text";
    const content = contentInput?.value.trim() || "";
    const isEditingCurrentPage = targetPage === page;

    if (!selector || !content) {
      showAdminNote("Enter a page and selector plus new content before saving.", "error");
      return;
    }

    if (contentType === "image" && !isValidImageUrl(content)) {
      showAdminNote("Enter a valid image URL to update photos.", "error");
      return;
    }

    const elements = isEditingCurrentPage ? Array.from(document.querySelectorAll(selector)) : [];
    if (isEditingCurrentPage && !elements.length) {
      showAdminNote("No matching page elements were found for that selector on the current page.", "error");
      return;
    }

    if (isEditingCurrentPage && contentType === "image") {
      const invalidImage = elements.some((element) => element.tagName !== "IMG");
      if (invalidImage) {
        showAdminNote("Photo URL updates only apply to <img> elements.", "error");
        return;
      }
    }

    if (isEditingCurrentPage && contentType === "text") {
      const invalidText = elements.some((element) => !ADMIN_TEXT_TAGS.includes(element.tagName));
      if (invalidText) {
        showAdminNote("Text updates only apply to visible text elements such as headings, paragraphs, and links.", "error");
        return;
      }
    }

    const result = await saveContentOverride(targetPage, selector, content, contentType);
    if (result.synced) {
      showAdminNote(
        isEditingCurrentPage
          ? "Content override saved and applied to this page."
          : "Content override saved. It will take effect when the selected page is loaded.",
        "success"
      );
    } else if (result.reason === "not-signed-in") {
      showAdminNote("Saved on this browser only — sign in as admin to save it for everyone.", "error");
    } else {
      showAdminNote("Applied here, but saving to the server failed. It won't survive a reload or show on other devices.", "error");
    }
    renderOverrides();
  });

  removeButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const targetPage = pageSelect?.value || "home";
    const selector = selectorInput?.value.trim();

    if (!selector) {
      showAdminNote("Enter the selector to remove.", "error");
      return;
    }

    clearContentOverride(targetPage, selector);
    showAdminNote("Content override removed.", "success");
    renderOverrides();
  });

  clearButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const targetPage = pageSelect?.value || "home";
    const overrides = getContentOverrides();
    if (overrides[targetPage]) {
      delete overrides[targetPage];
      safeSetStorage(CONTENT_STORE_KEY, JSON.stringify(overrides));
      showAdminNote("All overrides removed for this page.", "success");
      renderOverrides();
    }
  });

  templateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!templateTitle || !templateSubtitle || !templateNoteInput || !templateProgramLabel || !templateProgramMeta || !templateSignatory) {
      showTemplateStatus("Template fields are not available.", "error");
      return;
    }

    saveCertificateTemplate({
      title: templateTitle.value.trim() || defaultCertificateTemplate.title,
      subtitle: templateSubtitle.value.trim() || defaultCertificateTemplate.subtitle,
      note: templateNoteInput.value.trim() || defaultCertificateTemplate.note,
      programLabel: templateProgramLabel.value.trim() || defaultCertificateTemplate.programLabel,
      programMeta: templateProgramMeta.value.trim() || defaultCertificateTemplate.programMeta,
      signatory: templateSignatory.value.trim() || defaultCertificateTemplate.signatory
    });

    showTemplateStatus("Certificate template saved successfully.", "success");
  });

  document.getElementById("template-reset")?.addEventListener("click", (event) => {
    event.preventDefault();
    resetCertificateTemplate();
    loadTemplateForm();
    showTemplateStatus("Certificate template reset to defaults.", "success");
  });

  loadTemplateForm();

    // Populate course select with available courses (merged catalog)
    const populateAdminCourseSelect = () => {
      if (!courseSelect) return;
      const catalog = typeof getCourseCatalog === 'function' ? getCourseCatalog() : (window.BHF_COURSES || []);
      courseSelect.innerHTML = '<option value="">Select a course</option>' + catalog.map((c) => {
        const title = (c.title || c.course || '').trim();
        return `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`;
      }).join('');
    };
    populateAdminCourseSelect();

    // Upload PDF and attach to course document
    materialsForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!courseSelect || !materialsFileInput) return;
      const courseTitle = (courseSelect.value || '').trim();
      const file = materialsFileInput.files && materialsFileInput.files[0];
      if (!courseTitle) {
        if (materialsNote) { materialsNote.textContent = 'Select a target course.'; materialsNote.className = 'form-note error'; }
        return;
      }
      if (!file) {
        if (materialsNote) { materialsNote.textContent = 'Choose a PDF file to upload.'; materialsNote.className = 'form-note error'; }
        return;
      }

      try {
        const adminUser = getAuth();
        if (!adminUser) {
          if (materialsNote) { materialsNote.textContent = 'Please sign in as admin first.'; materialsNote.className = 'form-note error'; }
          return;
        }

        // If this is a course PDF, also attempt to auto-parse modules and exam questions.
        let parsedCourseData = null;
        try {
          parsedCourseData = await parseCoursePdfIntoCourseData({ file });
        } catch (parseError) {
          console.warn('PDF parsing failed for admin upload:', parseError);
        }

        // Upload to Firebase Storage
        const fileName = `${courseTitle.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
        const storageRef = ref(storage, `course-materials/${fileName}`);
        await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(storageRef);

        // Build the update payload. Always save the file URL, and add parsed
        // modules/questions if PDF parsing was successful.
        const courseUpdates = { materialsUrl: downloadUrl };
        if (parsedCourseData?.modules?.length) {
          courseUpdates.modules = parsedCourseData.modules;
        }
        if (parsedCourseData?.questions?.length) {
          courseUpdates.questions = parsedCourseData.questions;
        }

        const existing = typeof findSavedCourse === 'function' ? findSavedCourse(courseTitle) : null;
        if (existing) {
          await updateSavedCourse(courseTitle, courseUpdates);
        } else {
          await addSavedCourse({ title: courseTitle, ...courseUpdates });
        }

        if (materialsNote) {
          materialsNote.textContent = parsedCourseData && (parsedCourseData.modules.length || parsedCourseData.questions.length)
            ? 'PDF uploaded, parsed, and attached to course.'
            : 'PDF uploaded and attached to course.';
          materialsNote.className = 'form-note success';
        }
        // Refresh course catalog in page
        if (typeof loadCoursesCache === 'function') await loadCoursesCache();
        populateAdminCourseSelect();
      } catch (err) {
        console.error('Failed to upload course PDF', err);
        if (materialsNote) { materialsNote.textContent = 'Upload failed. See console for details.'; materialsNote.className = 'form-note error'; }
      }
      materialsFileInput.value = '';
    });

  // Category manager (admin-only)
  const categoryForm = document.getElementById('category-form');
  const categoryNameInput = document.getElementById('category-name');
  const categoryItems = document.getElementById('category-items');
  const categoryNote = document.getElementById('category-note');

  const showCategoryNote = (msg, type = 'success') => {
    if (!categoryNote) return;
    categoryNote.textContent = msg;
    categoryNote.className = `form-note ${type === 'success' ? 'success' : 'error'}`;
  };

  const renderCategories = () => {
    if (!categoryItems) return;
    const cats = getSavedCategories();
    categoryItems.innerHTML = '';
    if (!cats.length) {
      categoryItems.innerHTML = '<p class="form-note">No categories yet.</p>';
      return;
    }
    cats.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'override-item';
      const name = document.createElement('strong');
      name.textContent = c.name;
      const desc = document.createElement('p');
      desc.textContent = '';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.dataset.delete = c.name;
      editBtn.textContent = 'Delete';
      row.appendChild(name);
      row.appendChild(desc);
      row.appendChild(editBtn);
      categoryItems.appendChild(row);
    });
  };

    // Admin action info panel (show short descriptions when buttons clicked)
    const adminActionInfo = document.getElementById('admin-action-info');
    const adminActionButtons = Array.from(document.querySelectorAll('.admin-action'));
    const adminCoursePanel = document.getElementById('admin-course-panel');
    const embeddedAddProgramSection = document.getElementById('embedded-add-program');
    const materialsSection = document.querySelector('.materials-uploader');
    const categoryManager = document.getElementById('category-manager');
    const adminActionTexts = {
      'add-program': 'Add Program: Create new certification programs and quickly open the course builder to publish training content.',
      'publish-management': 'Publish Management: Review your live program catalog, update visibility, and keep published courses in sync with your training goals.',
      'upload-materials': 'Upload Course Materials (PDF): Attach a structured course PDF to any program so its modules, quizzes, and exams update automatically.',
      'program-categories': 'Program Categories: Organize your academy with tailored program categories and keep courses easy to find for learners.'
    };

    // Render a list of courses into the admin panel. If `publishedOnly` is
    // true, only show courses that have been saved to Firestore (have an id).
    const renderAdminCoursePanel = (publishedOnly = false) => {
      const panel = document.getElementById('admin-course-list-panel');
      if (!panel) return;
      const all = getCourseCatalog();
      const scoped = publishedOnly ? all.filter((course) => Boolean(course.id)) : all;
      if (!scoped.length) {
        panel.innerHTML = `<p class="form-note">No courses found.</p>`;
        return;
      }
      panel.innerHTML = `<div class="course-grid admin-course-grid">
        ${scoped.map((course) => `
          <article class="course-card admin-course-card">
            <div class="course-body">
              <span class="pill">${escapeHtml(course.category || 'General')}</span>
              ${course.instructorId ? `<span class="pill" style="background:#eef2ff;color:#3730a3;">Instructor: ${escapeHtml(course.instructorName || 'Unknown')}</span>` : ''}
              <h3>${escapeHtml(course.title)}</h3>
              <p>${escapeHtml(course.description || 'No description provided.')}</p>
            </div>
            <div class="course-actions admin-course-actions">
              <a class="btn btn-secondary" href="course-detail.html?course=${encodeURIComponent(course.title)}&category=${encodeURIComponent(course.category || '')}">Preview</a>
              <a class="btn btn-primary" href="add-course.html?edit=${encodeURIComponent(course.title)}">Edit</a>
            </div>
          </article>
        `).join('')}
      </div>`;
    };

    const savedOverridesSection = document.getElementById('saved-overrides-section');

    const hideAllAdminPanels = () => {
      if (adminForm) adminForm.style.display = 'none';
      if (adminCoursePanel) {
        adminCoursePanel.style.display = 'none';
        adminCoursePanel.innerHTML = '';
      }
      if (materialsSection) {
        materialsSection.hidden = true;
        materialsSection.style.display = 'none';
      }
      if (savedOverridesSection) savedOverridesSection.style.display = 'none';
      if (categoryManager) categoryManager.style.display = 'none';
      if (embeddedAddProgramSection) embeddedAddProgramSection.style.display = 'none';
      if (adminActionInfo) adminActionInfo.style.display = 'none';
    };

    const showAdminActionPanel = (key) => {
      const text = adminActionTexts[key] || 'No description available.';
      hideAllAdminPanels();

      if (adminActionInfo) {
        adminActionInfo.innerHTML = `<h3>${adminActionButtons.find((btn) => btn.dataset.action === key)?.textContent || 'Admin Action'}</h3><p class="form-note">${escapeHtml(text)}</p>`;
        adminActionInfo.style.display = '';
      }

      if (key === 'add-program') {
        if (embeddedAddProgramSection) {
          embeddedAddProgramSection.style.display = 'block';
          embeddedAddProgramSection.style.visibility = 'visible';
          embeddedAddProgramSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      if (key === 'publish-management') {
        if (adminCoursePanel) {
          adminCoursePanel.style.display = 'block';
          adminCoursePanel.style.visibility = 'visible';
          adminCoursePanel.innerHTML = '<h2>Published Courses</h2><div id="admin-course-list-panel"></div>';
          renderAdminCoursePanel(true);
          adminCoursePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      if (key === 'upload-materials') {
        if (materialsSection) {
          materialsSection.hidden = false;
          materialsSection.style.display = 'block';
          materialsSection.style.visibility = 'visible';
          materialsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      if (key === 'program-categories') {
        if (categoryManager) {
          categoryManager.style.display = 'block';
          categoryManager.style.visibility = 'visible';
          categoryManager.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    adminActionButtons.forEach((btn) => {
      if (btn.dataset.adminActionBound === 'true') return;
      btn.addEventListener('click', () => {
        adminActionButtons.forEach((candidate) => {
          candidate.classList.toggle('is-active', candidate === btn);
        });
        showAdminActionPanel(btn.dataset.action);
      });
      btn.dataset.adminActionBound = 'true';
    });

    window.setupAdminActionPanels = () => {
      const defaultButton = adminActionButtons.find((btn) => btn.dataset.action === 'add-program');
      if (defaultButton) {
        showAdminActionPanel(defaultButton.dataset.action);
      }
    };

    window.setupAdminActionPanels();

  categoryForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = categoryNameInput?.value.trim();
    if (!name) {
      showCategoryNote('Enter a category name.', 'error');
      return;
    }
    try {
      await addSavedCategory(name);
      showCategoryNote(`Category added: ${name}`, 'success');
      categoryNameInput.value = '';
      renderCategories();
      if (typeof populateCategoryOptions === 'function') populateCategoryOptions();
      showToast(`Category saved: ${name}`, 'success');
    } catch (err) {
      console.error('Failed to save category', err);
      showCategoryNote('Unable to save category.', 'error');
    }
  });

  categoryItems?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const name = btn.dataset.delete;
    if (!name) return;
    const confirmed = window.confirm(`Delete category "${name}"?`);
    if (!confirmed) return;
    try {
      await removeSavedCategory(name);
      renderCategories();
      if (typeof populateCategoryOptions === 'function') populateCategoryOptions();
      showToast(`Category removed: ${name}`, 'info');
    } catch (err) {
      console.error('Failed to remove category', err);
      showCategoryNote('Unable to remove category.', 'error');
    }
  });

  // Initial render of categories in admin
  renderCategories();
  // Categories now stream in live (see watchCategories()), so this list
  // stays current if a category is added/removed from another page/tab.
  document.addEventListener('categories:updated', renderCategories);

  overridesList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editSelector = target.dataset.selector;
    const removeSelector = target.dataset.removeSelector;
    const currentPage = pageSelect?.value || "home";
    const overrides = getContentOverrides()[currentPage] || {};

    if (editSelector) {
      selectorInput.value = editSelector;
      const entry = overrides[editSelector];
      contentInput.value = entry?.value || "";
      if (contentTypeSelect) {
        contentTypeSelect.value = entry?.type || "text";
      }
      showAdminNote("Loaded override for editing.", "success");
    }

    if (removeSelector) {
      clearContentOverride(currentPage, removeSelector);
      showAdminNote("Override removed.", "success");
      renderOverrides();
    }
  });

  /* =============================================
     Admin Dashboard: Enrollees, Upcoming Exam, Calendar,
     Notifications (Firestore-backed, admin-only panels)
  ============================================= */
  const formatDateLabel = (isoOrDateStr) => {
    if (!isoOrDateStr) return "—";
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return String(isoOrDateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  const timeAgo = (isoStr) => {
    if (!isoStr) return "";
    const then = new Date(isoStr).getTime();
    if (isNaN(then)) return "";
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDateLabel(isoStr);
  };

  /* ---- Enrollees ---- */
  let enrolleesInitialized = false;
  window.initAdminEnrollees = async () => {
    const wrap = document.getElementById("enrollees-table-wrap");
    const badge = document.getElementById("enrollees-count-badge");
    const search = document.getElementById("enrollees-search");
    const refreshBtn = document.getElementById("enrollees-refresh");
    if (!wrap) return;

    const render = () => {
      const records = getEnrollmentRecords();
      const term = (search?.value || "").trim().toLowerCase();
      const filtered = term
        ? records.filter((r) => [r.name, r.email, r.course, r.category].filter(Boolean).join(" ").toLowerCase().includes(term))
        : records;
      const sorted = [...filtered].sort((a, b) => new Date(b.enrolledAt || 0) - new Date(a.enrolledAt || 0));
      if (badge) badge.textContent = `${records.length} Enrollee${records.length === 1 ? "" : "s"}`;
      if (!sorted.length) {
        wrap.innerHTML = `<p class="form-note">No enrollees ${term ? "match your search" : "yet"}.</p>`;
        return;
      }
      wrap.innerHTML = `
        <table class="dash-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Course</th><th>Category</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${sorted.map((r) => `
              <tr>
                <td>${escapeHtml(r.name || "—")}</td>
                <td>${escapeHtml(r.email || "—")}</td>
                <td>${escapeHtml(r.course || "—")}</td>
                <td><span class="pill">${escapeHtml(r.category || "General")}</span></td>
                <td>${formatDateLabel(r.enrolledAt)}</td>
                <td><span class="dash-status">${escapeHtml(r.status || "in-progress")}${r.paid ? ' · <strong>Paid</strong>' : ''}</span></td>
                <td>
                  ${r.paid ? '<span class="pill is-ok">FTF Paid</span>' : `<button type="button" class="btn btn-primary enrollees-mark-ftf-btn" data-enroll-id="${r.id}">Mark FTF Paid & Activate</button>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    };

    wrap.innerHTML = `<p class="form-note">Loading enrollees…</p>`;
    await loadEnrollmentsCache();
    render();

    if (!enrolleesInitialized) {
      enrolleesInitialized = true;
      search?.addEventListener("input", render);
      refreshBtn?.addEventListener("click", async () => {
        wrap.innerHTML = `<p class="form-note">Refreshing…</p>`;
        await loadEnrollmentsCache();
        render();
      });

      // Handle FTF payment button clicks
      wrap.addEventListener('click', async (ev) => {
        const btn = ev.target.closest?.('.enrollees-mark-ftf-btn');
        if (!btn) return;
        const enrollId = btn.getAttribute('data-enroll-id');
        if (!enrollId) return;
        btn.disabled = true;
        const records = getEnrollmentRecords();
        const rec = records.find((r) => r.id === enrollId);
        try {
          const ok = await markEnrollmentFTFPaid(enrollId);
          if (ok) {
            // Grant local course access (so admin can test immediately)
            if (rec && rec.course && rec.email) markCourseAccessPaid(rec.course, rec.email);
            await loadEnrollmentsCache();
            render();
            showToast('FTF payment recorded and course activated.', 'success');
            window.refreshAdminNotificationBadge?.();
          } else {
            btn.disabled = false;
            showToast('Unable to record payment. See console for details.', 'error');
          }
        } catch (err) {
          console.error('FTF payment handler error', err);
          btn.disabled = false;
          showToast('Unable to record payment. See console for details.', 'error');
        }
      });
    }
  };

  /* ---- Upcoming Exams ---- */
  let examsInitialized = false;
  window.initAdminExams = async () => {
    const list = document.getElementById("upcoming-exams-list");
    const badge = document.getElementById("exams-count-badge");
    const form = document.getElementById("exam-schedule-form");
    const courseSelect = document.getElementById("exam-course-select");
    const dateInput = document.getElementById("exam-date-input");
    const timeInput = document.getElementById("exam-time-input");
    const notesInput = document.getElementById("exam-notes-input");
    const note = document.getElementById("exam-schedule-note");
    if (!list) return;

    const populateCourses = () => {
      if (!courseSelect) return;
      const catalog = getCourseCatalog();
      const current = courseSelect.value;
      courseSelect.innerHTML = '<option value="">Choose a course</option>' +
        catalog.map((c) => `<option value="${escapeHtml(c.title)}">${escapeHtml(c.title)}</option>`).join("");
      if (current) courseSelect.value = current;
    };

    const renderList = () => {
      const all = getExamSchedule();
      const todayStr = new Date().toISOString().slice(0, 10);
      const upcoming = all.filter((e) => (e.examDate || "") >= todayStr);
      if (badge) badge.textContent = `${upcoming.length} Scheduled`;
      if (!all.length) {
        list.innerHTML = `<p class="form-note">No exams scheduled yet.</p>`;
        return;
      }
      const sorted = [...all].sort((a, b) => new Date(a.examDate || 0) - new Date(b.examDate || 0));
      list.innerHTML = sorted.map((e) => {
        const isPast = (e.examDate || "") < todayStr;
        return `
          <div class="dash-list-item${isPast ? " dash-list-item-past" : ""}">
            <div class="dash-list-item-main">
              <strong>${escapeHtml(e.course || "Untitled course")}</strong>
              <span class="pill">${escapeHtml(e.category || "General")}</span>
              <p class="form-note" style="margin:0.25rem 0 0;">${formatDateLabel(e.examDate)}${e.examTime ? ` · ${escapeHtml(e.examTime)}` : ""}${e.notes ? ` — ${escapeHtml(e.notes)}` : ""}</p>
            </div>
            <button type="button" class="btn btn-secondary dash-remove-btn" data-exam-id="${e.id}">Remove</button>
          </div>
        `;
      }).join("");
    };

    list.innerHTML = `<p class="form-note">Loading upcoming exams…</p>`;
    await Promise.all([coursesReadyPromise, loadExamScheduleCache()]);
    populateCourses();
    renderList();

    if (!examsInitialized) {
      examsInitialized = true;
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const courseTitle = courseSelect?.value;
        const examDate = dateInput?.value;
        if (!courseTitle || !examDate) {
          if (note) { note.textContent = "Choose a course and a date."; note.className = "form-note error"; }
          return;
        }
        const course = getCourseCatalog().find((c) => c.title === courseTitle);
        try {
          await addExamScheduleEntry({
            course: courseTitle,
            category: course?.category || "General",
            examDate,
            examTime: timeInput?.value || "",
            notes: notesInput?.value.trim() || ""
          });
          if (note) { note.textContent = `Exam scheduled for ${courseTitle}.`; note.className = "form-note success"; }
          form.reset();
          renderList();
          showToast(`Exam scheduled: ${courseTitle}`, "success");
          window.refreshAdminNotificationBadge?.();
        } catch (err) {
          console.error("Failed to schedule exam", err);
          if (note) { note.textContent = "Unable to schedule exam."; note.className = "form-note error"; }
        }
      });

      list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-exam-id]");
        if (!btn) return;
        const confirmed = window.confirm("Remove this scheduled exam?");
        if (!confirmed) return;
        try {
          await removeExamScheduleEntry(btn.dataset.examId);
          renderList();
          showToast("Exam removed.", "info");
        } catch (err) {
          console.error("Failed to remove exam", err);
        }
      });
    }
  };

  /* ---- Calendar ---- */
  let calendarState = null; // { year, month }
  window.initAdminCalendar = async () => {
    const grid = document.getElementById("calendar-grid");
    const label = document.getElementById("calendar-month-label");
    const monthBadge = document.getElementById("calendar-month-badge");
    const detail = document.getElementById("calendar-day-detail");
    const prevBtn = document.getElementById("calendar-prev");
    const nextBtn = document.getElementById("calendar-next");
    if (!grid) return;

    await loadExamScheduleCache();

    const today = new Date();
    if (!calendarState) {
      calendarState = { year: today.getFullYear(), month: today.getMonth() };
    }

    const examsByDate = () => {
      const map = {};
      getExamSchedule().forEach((e) => {
        if (!e.examDate) return;
        map[e.examDate] = map[e.examDate] || [];
        map[e.examDate].push(e);
      });
      return map;
    };

    const renderCalendar = () => {
      const { year, month } = calendarState;
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      if (label) label.textContent = `${monthNames[month]} ${year}`;
      if (monthBadge) monthBadge.textContent = `${monthNames[month]} ${year}`;

      const firstDay = new Date(year, month, 1);
      const startWeekday = firstDay.getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const map = examsByDate();
      const todayStr = new Date().toISOString().slice(0, 10);

      let cells = "";
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
        cells += `<div class="dash-cal-weekday">${d}</div>`;
      });
      for (let i = 0; i < startWeekday; i++) {
        cells += `<div class="dash-cal-cell dash-cal-cell-empty"></div>`;
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const hasExam = Boolean(map[dateStr]?.length);
        const isToday = dateStr === todayStr;
        cells += `
          <button type="button" class="dash-cal-cell${hasExam ? " dash-cal-cell-has-exam" : ""}${isToday ? " dash-cal-cell-today" : ""}" data-date="${dateStr}">
            <span>${day}</span>
            ${hasExam ? '<i class="dash-cal-dot"></i>' : ""}
          </button>
        `;
      }
      grid.innerHTML = cells;

      grid.querySelectorAll("[data-date]").forEach((cell) => {
        cell.addEventListener("click", () => {
          const dateStr = cell.dataset.date;
          const exams = map[dateStr] || [];
          if (!detail) return;
          if (!exams.length) {
            detail.innerHTML = `<p class="form-note">No exams scheduled on ${formatDateLabel(dateStr)}.</p>`;
            return;
          }
          detail.innerHTML = `
            <h4>${formatDateLabel(dateStr)}</h4>
            ${exams.map((e) => `
              <div class="dash-list-item">
                <div class="dash-list-item-main">
                  <strong>${escapeHtml(e.course)}</strong>
                  <span class="pill">${escapeHtml(e.category || "General")}</span>
                  <p class="form-note" style="margin:0.25rem 0 0;">${e.examTime ? escapeHtml(e.examTime) : ""}${e.notes ? ` — ${escapeHtml(e.notes)}` : ""}</p>
                </div>
              </div>
            `).join("")}
          `;
        });
      });
    };

    renderCalendar();

    if (prevBtn && !prevBtn.dataset.bound) {
      prevBtn.dataset.bound = "1";
      prevBtn.addEventListener("click", () => {
        calendarState.month -= 1;
        if (calendarState.month < 0) { calendarState.month = 11; calendarState.year -= 1; }
        renderCalendar();
      });
    }
    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = "1";
      nextBtn.addEventListener("click", () => {
        calendarState.month += 1;
        if (calendarState.month > 11) { calendarState.month = 0; calendarState.year += 1; }
        renderCalendar();
      });
    }
  };

  /* ---- Notifications ---- */
  let notificationsInitialized = false;
  window.refreshAdminNotificationBadge = async () => {
    if (!isAdmin()) return;
    try {
      await loadNotificationsCache();
      const unread = getNotificationRecords().filter((n) => !n.read).length;
      const btn = document.getElementById("admin-notifications-btn");
      if (btn) btn.textContent = unread > 0 ? `🔔 Notifications (${unread})` : "🔔 Notifications";
    } catch {
      // ignore badge refresh errors
    }
  };

  window.initAdminNotifications = async () => {
    const list = document.getElementById("notifications-list");
    const badge = document.getElementById("notifications-count-badge");
    const markAllBtn = document.getElementById("notifications-mark-all");
    const refreshBtn = document.getElementById("notifications-refresh");
    if (!list) return;

    const iconFor = (type) => ({ enrollment: "🎓", certificate: "🏅", exam: "📝" }[type] || "🔔");

    const render = () => {
      const records = getNotificationRecords();
      const unread = records.filter((n) => !n.read).length;
      if (badge) badge.textContent = `${unread} Unread`;
      if (!records.length) {
        list.innerHTML = `<p class="form-note">No notifications yet.</p>`;
        return;
      }
      list.innerHTML = records.map((n) => `
        <div class="dash-list-item${n.read ? "" : " dash-list-item-unread"}">
          <div class="dash-list-item-main">
            <span style="margin-right:0.4rem;">${iconFor(n.type)}</span>
            <span>${escapeHtml(n.message || "")}</span>
            <p class="form-note" style="margin:0.25rem 0 0;">${timeAgo(n.createdAt)}</p>
          </div>
          ${n.read ? "" : `<button type="button" class="btn btn-secondary dash-mark-read-btn" data-notif-read="${n.id}">Mark read</button>`}
        </div>
      `).join("");
      window.refreshAdminNotificationBadge();
    };

    list.innerHTML = `<p class="form-note">Loading notifications…</p>`;
    await loadNotificationsCache();
    render();

    if (!notificationsInitialized) {
      notificationsInitialized = true;
      markAllBtn?.addEventListener("click", async () => {
        await markAllNotificationsRead();
        render();
        showToast("All notifications marked as read.", "success");
      });
      refreshBtn?.addEventListener("click", async () => {
        list.innerHTML = `<p class="form-note">Refreshing…</p>`;
        await loadNotificationsCache();
        render();
      });
      list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-notif-read]");
        if (!btn) return;
        await markNotificationRead(btn.dataset.notifRead);
        await loadNotificationsCache();
        render();
      });
    }
  };

  /* ---- Manage Instructors ---- */
  let instructorsInitialized = false;
  window.initAdminInstructors = async () => {
    const list = document.getElementById("instructor-list");
    const badge = document.getElementById("instructor-count-badge");
    const form = document.getElementById("instructor-form");
    const nameInput = document.getElementById("instructor-name");
    const emailInput = document.getElementById("instructor-email");
    const passwordInput = document.getElementById("instructor-password");
    const note = document.getElementById("instructor-note");
    if (!list) return;

    const showNote = (message, type = "success") => {
      if (!note) return;
      note.textContent = message;
      note.className = `form-note ${type}`;
    };

    const render = () => {
      const records = getInstructors();
      if (badge) badge.textContent = `${records.length} Instructor${records.length === 1 ? "" : "s"}`;
      if (!records.length) {
        list.innerHTML = `<p class="form-note">No instructors added yet. Use the form above to create your first instructor account.</p>`;
        return;
      }
      const ownedCourseCounts = getCourseCatalog().reduce((map, c) => {
        if (c.instructorId) map[c.instructorId] = (map[c.instructorId] || 0) + 1;
        return map;
      }, {});
      list.innerHTML = records.map((inst) => `
        <div class="dash-list-item">
          <div class="dash-list-item-main">
            <strong>${escapeHtml(inst.name || "Unnamed instructor")}</strong>
            <span class="pill">${escapeHtml(inst.email || "")}</span>
            <p class="form-note" style="margin:0.25rem 0 0;">${ownedCourseCounts[inst.uid] || 0} course${(ownedCourseCounts[inst.uid] || 0) === 1 ? "" : "s"} published &middot; added ${formatDateLabel(inst.createdAt)}</p>
          </div>
          <button type="button" class="btn btn-secondary dash-remove-btn" data-instructor-uid="${inst.uid}">Remove Access</button>
        </div>
      `).join("");
    };

    list.innerHTML = `<p class="form-note">Loading instructors…</p>`;
    await loadInstructorsCache();
    render();

    if (!instructorsInitialized) {
      instructorsInitialized = true;
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = nameInput?.value.trim() || "";
        const email = emailInput?.value.trim().toLowerCase() || "";
        const password = passwordInput?.value || "";
        const submitBtn = document.getElementById("instructor-add");

        if (!name || !email || !password) {
          showNote("Fill in name, email, and password.", "error");
          return;
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          await createInstructorAccount({ name, email, password });
          showNote(`Instructor account created for ${name}. They can now log in at the Login page.`, "success");
          showToast(`Instructor added: ${name}`, "success");
          form.reset();
          render();
        } catch (err) {
          console.error("Failed to create instructor account", err);
          showNote(describeAuthError(err) !== "Something went wrong. Please try again." ? describeAuthError(err) : (err.message || "Unable to create instructor account."), "error");
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });

      list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-instructor-uid]");
        if (!btn) return;
        const confirmed = window.confirm("Remove this instructor's portal access? Their existing courses will stay published.");
        if (!confirmed) return;
        try {
          await removeInstructorAccount(btn.dataset.instructorUid);
          render();
          showToast("Instructor access removed.", "info");
        } catch (err) {
          console.error("Failed to remove instructor", err);
          showNote("Unable to remove instructor.", "error");
        }
      });
    }
  };

  // Populate the notification bell badge as soon as the admin panel loads.
  window.refreshAdminNotificationBadge();

  renderOverrides();
  }
}

if (page === "instructor") {
  const auth = getAuth();
  const isLocalPreview = window.location.protocol === "file:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (!isLocalPreview && !auth) {
    window.location.href = "login.html";
  } else if (!isLocalPreview && !isAdminOrInstructor()) {
    window.location.href = "dashboard.html";
  } else {

  // Instructors only ever see/manage courses they created. Admins visiting
  // this page (e.g. to check the instructor experience) see everything.
  const myCourses = () => {
    const all = getCourseCatalog().filter((c) => Boolean(c.id));
    if (isAdmin()) return all;
    return all.filter((c) => c.instructorId === currentUser?.uid);
  };

  /* ---- My Courses ---- */
  window.initInstructorCourses = async () => {
    await (window.dataReadyPromise || Promise.resolve());
    const panel = document.getElementById('instructor-course-list-panel');
    const badge = document.getElementById('instructor-courses-count-badge');
    if (!panel) return;
    const courses = myCourses();
    if (badge) badge.textContent = `${courses.length} Course${courses.length === 1 ? '' : 's'}`;
    if (!courses.length) {
      panel.innerHTML = `<p class="form-note">You haven't published any courses yet. Use "Add Program" to create your first one.</p>`;
      return;
    }
    panel.innerHTML = `<div class="course-grid admin-course-grid">
      ${courses.map((course) => {
        const moduleCount = Array.isArray(course.modules) ? course.modules.length : 0;
        const quizCount = Array.isArray(course.quizQuestions) ? course.quizQuestions.length : (Array.isArray(course.questions) ? course.questions.length : 0);
        const examCount = Array.isArray(course.examQuestions) ? course.examQuestions.length : (Array.isArray(course.questions) ? course.questions.length : 0);

        const modulesHtml = Array.isArray(course.modules) && course.modules.length
          ? `<ul class="course-modules-list">${course.modules.map((m) => `<li><strong>${escapeHtml(m.title || 'Untitled')}</strong><div class="form-note" style="margin:4px 0 0;">${escapeHtml((m.content || '').slice(0,160))}${(m.content||'').length>160? '…':''}</div></li>`).join('')}</ul>`
          : `<p class="ix-empty">No modules uploaded for this course.</p>`;

        const examSource = Array.isArray(course.examQuestions) ? course.examQuestions : (Array.isArray(course.questions) ? course.questions : []);
        const examHtml = examSource && examSource.length
          ? `<ol class="course-exam-list">${examSource.map((q) => `<li>${escapeHtml(typeof q === 'string' ? q : (q.q || q.question || JSON.stringify(q).slice(0,120)))}</li>`).join('')}</ol>`
          : `<p class="ix-empty">No exam questions uploaded for this course.</p>`;

        const quizSource = Array.isArray(course.quizQuestions) ? course.quizQuestions : (Array.isArray(course.questions) ? course.questions : []);
        const quizHtml = quizSource && quizSource.length
          ? `<ol class="course-quiz-list">${quizSource.map((q) => `<li>${escapeHtml(typeof q === 'string' ? q : (q.q || q.question || JSON.stringify(q).slice(0,120)))}</li>`).join('')}</ol>`
          : `<p class="ix-empty">No quiz questions uploaded for this course.</p>`;

        return `
        <article class="course-card admin-course-card" data-module-count="${moduleCount}" data-question-count="${examCount}">
          <div class="course-body">
            <span class="pill">${escapeHtml(course.category || 'General')}</span>
            <h3>${escapeHtml(course.title)}</h3>
            <p>${escapeHtml(course.description || 'No description provided.')}</p>
            <p class="form-note" style="margin:0.4rem 0 0;">🧩 ${moduleCount} module${moduleCount === 1 ? '' : 's'} &nbsp;·&nbsp; 📝 ${examCount} exam question${examCount === 1 ? '' : 's'} &nbsp;·&nbsp; ❓ ${quizCount} quiz question${quizCount === 1 ? '' : 's'}</p>
            <details style="margin-top:0.8rem;">
              <summary style="font-weight:700;">Modules (${moduleCount})</summary>
              ${modulesHtml}
            </details>
            <details style="margin-top:0.6rem;">
              <summary style="font-weight:700;">Quiz Questions (${quizCount})</summary>
              ${quizHtml}
            </details>
            <details style="margin-top:0.6rem;">
              <summary style="font-weight:700;">Exam Questions (${examCount})</summary>
              ${examHtml}
            </details>
          </div>
          <div class="course-actions admin-course-actions">
            <a class="btn btn-secondary" href="course-detail.html?course=${encodeURIComponent(course.title)}&category=${encodeURIComponent(course.category || '')}">Preview</a>
            <a class="btn btn-primary" href="add-course.html?edit=${encodeURIComponent(course.title)}">Edit</a>
            <button type="button" class="btn btn-secondary ix-delete-course-btn" data-course-title="${escapeHtml(course.title)}" style="color:#b42318;border-color:rgba(180,35,24,0.35);">🗑 Delete</button>
          </div>
        </article>
      `;
      }).join('')}
    </div>`;

    // Event delegation so this works no matter how many times the panel
    // re-renders — one listener, attached once per panel element.
    if (!panel.dataset.deleteBound) {
      panel.dataset.deleteBound = '1';
      panel.addEventListener('click', async (e) => {
        const btn = e.target.closest('.ix-delete-course-btn');
        if (!btn) return;
        const title = btn.dataset.courseTitle;
        if (!title) return;
        const confirmed = window.confirm(`Delete "${title}"? This removes the course, its modules, and its exam questions permanently. This can't be undone.`);
        if (!confirmed) return;
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          await removeSavedCourse(title);
          if (typeof window.showToast === 'function') window.showToast(`Course deleted: ${title}`, 'info');
          window.initInstructorCourses();
        } catch (err) {
          console.error('Failed to delete course', err);
          window.alert('Unable to delete this course right now. Please try again.');
          btn.disabled = false;
          btn.textContent = '🗑 Delete';
        }
      });
    }
  };

  /* ---- Upload Course Materials (own courses only) ---- */
  const courseSelect = document.getElementById('admin-course-select');
  const materialsForm = document.getElementById('materials-form');
  const materialsFileInput = document.getElementById('admin-course-material-file');
  const materialsNote = document.getElementById('materials-note');

  const populateInstructorCourseSelect = () => {
    if (!courseSelect) return;
    const courses = myCourses();
    courseSelect.innerHTML = '<option value="">Choose a course to attach materials to</option>' +
      courses.map((c) => `<option value="${escapeHtml(c.title)}">${escapeHtml(c.title)}</option>`).join('');
  };
  populateInstructorCourseSelect();

  materialsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!courseSelect || !materialsFileInput) return;
    const courseTitle = (courseSelect.value || '').trim();
    const file = materialsFileInput.files && materialsFileInput.files[0];
    if (!courseTitle) {
      if (materialsNote) { materialsNote.textContent = 'Select one of your courses.'; materialsNote.className = 'form-note error'; }
      return;
    }
    if (!file) {
      if (materialsNote) { materialsNote.textContent = 'Choose a PDF file to upload.'; materialsNote.className = 'form-note error'; }
      return;
    }
    // Guard against tampering with the <select> to target a course this
    // instructor doesn't own.
    const targetCourse = myCourses().find((c) => c.title === courseTitle);
    if (!isAdmin() && !targetCourse) {
      if (materialsNote) { materialsNote.textContent = 'You can only attach materials to your own courses.'; materialsNote.className = 'form-note error'; }
      return;
    }

    try {
      let parsedCourseData = null;
      try {
        parsedCourseData = await parseCoursePdfIntoCourseData({ file });
      } catch (parseError) {
        console.warn('PDF parsing failed for instructor upload:', parseError);
      }

      const fileName = `${courseTitle.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
      const storageRef = ref(storage, `course-materials/${fileName}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      const courseUpdates = { materialsUrl: downloadUrl };
      if (parsedCourseData?.modules?.length) courseUpdates.modules = parsedCourseData.modules;
      if (parsedCourseData?.questions?.length) courseUpdates.questions = parsedCourseData.questions;

      await updateSavedCourse(courseTitle, courseUpdates);

      if (materialsNote) {
        materialsNote.textContent = parsedCourseData && (parsedCourseData.modules.length || parsedCourseData.questions.length)
          ? 'PDF uploaded, parsed, and attached to your course.'
          : 'PDF uploaded and attached to your course.';
        materialsNote.className = 'form-note success';
      }
      await loadCoursesCache();
      populateInstructorCourseSelect();
      showToast(`Materials attached: ${courseTitle}`, 'success');
    } catch (err) {
      console.error('Failed to upload course PDF', err);
      if (materialsNote) { materialsNote.textContent = 'Upload failed. See console for details.'; materialsNote.className = 'form-note error'; }
    }
    materialsFileInput.value = '';
  });

  /* ---- Schedule Exam (own courses only) ---- */
  let instructorExamsInitialized = false;
  window.initInstructorExams = async () => {
    const list = document.getElementById("upcoming-exams-list");
    const badge = document.getElementById("exams-count-badge");
    const form = document.getElementById("exam-schedule-form");
    const examCourseSelect = document.getElementById("exam-course-select");
    const dateInput = document.getElementById("exam-date-input");
    const timeInput = document.getElementById("exam-time-input");
    const notesInput = document.getElementById("exam-notes-input");
    const note = document.getElementById("exam-schedule-note");
    if (!list) return;

    const formatDateLabel = (isoOrDateStr) => {
      if (!isoOrDateStr) return "—";
      const d = new Date(isoOrDateStr);
      if (isNaN(d.getTime())) return String(isoOrDateStr);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    };

    const populateCourses = () => {
      if (!examCourseSelect) return;
      const courses = myCourses();
      const current = examCourseSelect.value;
      examCourseSelect.innerHTML = '<option value="">Choose one of your courses</option>' +
        courses.map((c) => `<option value="${escapeHtml(c.title)}">${escapeHtml(c.title)}</option>`).join("");
      if (current) examCourseSelect.value = current;
    };

    const myExams = () => {
      const all = getExamSchedule();
      if (isAdmin()) return all;
      const ownTitles = new Set(myCourses().map((c) => c.title));
      return all.filter((e) => e.instructorId === currentUser?.uid || ownTitles.has(e.course));
    };

    const renderList = () => {
      const all = myExams();
      const todayStr = new Date().toISOString().slice(0, 10);
      const upcoming = all.filter((e) => (e.examDate || "") >= todayStr);
      if (badge) badge.textContent = `${upcoming.length} Scheduled`;
      if (!all.length) {
        list.innerHTML = `<p class="form-note">No exams scheduled yet.</p>`;
        return;
      }
      const sorted = [...all].sort((a, b) => new Date(a.examDate || 0) - new Date(b.examDate || 0));
      list.innerHTML = sorted.map((e) => {
        const isPast = (e.examDate || "") < todayStr;
        return `
          <div class="dash-list-item${isPast ? " dash-list-item-past" : ""}">
            <div class="dash-list-item-main">
              <strong>${escapeHtml(e.course || "Untitled course")}</strong>
              <span class="pill">${escapeHtml(e.category || "General")}</span>
              <p class="form-note" style="margin:0.25rem 0 0;">${formatDateLabel(e.examDate)}${e.examTime ? ` · ${escapeHtml(e.examTime)}` : ""}${e.notes ? ` — ${escapeHtml(e.notes)}` : ""}</p>
            </div>
            <button type="button" class="btn btn-secondary dash-remove-btn" data-exam-id="${e.id}">Remove</button>
          </div>
        `;
      }).join("");
    };

    list.innerHTML = `<p class="form-note">Loading upcoming exams…</p>`;
    await Promise.all([coursesReadyPromise, loadExamScheduleCache()]);
    populateCourses();
    renderList();

    if (!instructorExamsInitialized) {
      instructorExamsInitialized = true;
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const courseTitle = examCourseSelect?.value;
        const examDate = dateInput?.value;
        if (!courseTitle || !examDate) {
          if (note) { note.textContent = "Choose a course and a date."; note.className = "form-note error"; }
          return;
        }
        const course = myCourses().find((c) => c.title === courseTitle);
        if (!isAdmin() && !course) {
          if (note) { note.textContent = "You can only schedule exams for your own courses."; note.className = "form-note error"; }
          return;
        }
        try {
          await addExamScheduleEntry({
            course: courseTitle,
            category: course?.category || "General",
            examDate,
            examTime: timeInput?.value || "",
            notes: notesInput?.value.trim() || "",
            instructorId: currentUser?.uid || null
          });
          if (note) { note.textContent = `Exam scheduled for ${courseTitle}.`; note.className = "form-note success"; }
          form.reset();
          renderList();
          showToast(`Exam scheduled: ${courseTitle}`, "success");
        } catch (err) {
          console.error("Failed to schedule exam", err);
          if (note) { note.textContent = "Unable to schedule exam."; note.className = "form-note error"; }
        }
      });

      list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-exam-id]");
        if (!btn) return;
        const confirmed = window.confirm("Remove this scheduled exam?");
        if (!confirmed) return;
        try {
          await removeExamScheduleEntry(btn.dataset.examId);
          renderList();
          showToast("Exam removed.", "info");
        } catch (err) {
          console.error("Failed to remove exam", err);
        }
      });
    }
  };

  }
}

if (page === "add-course") {
  const courseForm = document.getElementById("course-builder-form");
  const titleInput = document.getElementById("course-title");
  const categoryInput = document.getElementById("course-category");
  const descriptionInput = document.getElementById("course-description");
  const imageInput = document.getElementById("course-image");
  const imageFileInput = document.getElementById("course-image-file");
  const imagePreview = document.getElementById("course-image-preview");
  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const readFileAsText = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  // Uploading a thumbnail file takes priority over the URL field, and
  // shows an instant preview so the admin/instructor can confirm it's the
  // right image before publishing — matching the "I should see the image
  // immediately" expectation instead of only finding out after saving.
  imageFileInput?.addEventListener("change", async () => {
    const file = imageFileInput.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (imagePreview) {
        imagePreview.src = dataUrl;
        imagePreview.style.display = dataUrl ? "block" : "none";
      }
      // Uploading a file overrides any pasted URL, so it's unambiguous
      // which one gets saved.
      if (imageInput) imageInput.value = "";
    } catch (err) {
      console.error("Failed to read thumbnail image file", err);
    }
  });
  imageInput?.addEventListener("input", () => {
    // Typing/pasting a URL overrides a previously chosen file upload.
    if (imageInput.value.trim() && imageFileInput) imageFileInput.value = "";
    if (imagePreview) {
      if (imageInput.value.trim()) {
        imagePreview.src = imageInput.value.trim();
        imagePreview.style.display = "block";
      } else {
        imagePreview.style.display = "none";
      }
    }
  });
  const levelInput = document.getElementById("course-level");
  const accessRuleInput = document.getElementById("course-access-rule");
  const accessFreeBtn = document.getElementById("course-access-free-btn");
  const accessPaidBtn = document.getElementById("course-access-paid-btn");
  const setAccessRule = (rule) => {
    const value = rule === "paid" ? "paid" : "free";
    if (accessRuleInput) accessRuleInput.value = value;
    accessFreeBtn?.classList.toggle("is-active", value === "free");
    accessPaidBtn?.classList.toggle("is-active", value === "paid");
  };
  accessFreeBtn?.addEventListener("click", () => setAccessRule("free"));
  accessPaidBtn?.addEventListener("click", () => setAccessRule("paid"));
  const questionBuilder = document.getElementById("question-builder");
  const examQuestionBuilder = document.getElementById("exam-question-builder");
  const moduleBuilder = document.getElementById("module-builder");
  const addQuestionBtn = document.getElementById("add-question-btn");
  const addExamQuestionBtn = document.getElementById("add-exam-question-btn");
  const courseNote = document.getElementById("course-builder-note");
  const modulePdfInput = document.getElementById("module-pdf-file");
  const quizPdfInput = document.getElementById("quiz-pdf-file");
  const examPdfInput = document.getElementById("exam-pdf-file");

  if (!isAuthenticated()) {
    window.location.href = "login.html";
  }

  if (!isAdminOrInstructor()) {
    window.location.href = "dashboard.html";
  }

  // Instructors may only edit their own courses. If an instructor lands on
  // this page with ?edit=<title> for a course they don't own, bounce them
  // back to their portal instead of letting the form silently overwrite it.
  if (isInstructor()) {
    const editKeyGuard = new URLSearchParams(window.location.search).get('edit');
    if (editKeyGuard) {
      const existingCourse = typeof findSavedCourse === 'function' ? findSavedCourse(editKeyGuard) : null;
      if (existingCourse && existingCourse.instructorId && existingCourse.instructorId !== currentUser?.uid) {
        window.location.href = "instructor.html";
      }
    }
  }

  const buildQuestionCard = (index, question = {}) => {
    const questionText = question.q || "";
    const options = question.options || ["", "", "", ""];
    const answer = Number.isFinite(question.answer) ? question.answer : (Number.isFinite(question.correct) ? question.correct : 0);
    return `
      <div class="question-card">
        <div class="question-card-header">
          <h3 class="question-card-title">Question ${index}</h3>
          <button type="button" class="remove-card-btn">Remove</button>
        </div>
        <!-- module selector removed per user request -->
        <div class="form-row">
          <label>Question ${index}</label>
          <input type="text" class="course-question-text" placeholder="Enter a question" value="${questionText.replace(/"/g, '&quot;')}" />
        </div>
        <div class="form-row">
          <label>Options</label>
          <div class="question-options">
            <input type="text" class="course-question-option" placeholder="Option 1" value="${(options[0] || '').replace(/"/g, '&quot;')}" />
            <input type="text" class="course-question-option" placeholder="Option 2" value="${(options[1] || '').replace(/"/g, '&quot;')}" />
            <input type="text" class="course-question-option" placeholder="Option 3" value="${(options[2] || '').replace(/"/g, '&quot;')}" />
            <input type="text" class="course-question-option" placeholder="Option 4" value="${(options[3] || '').replace(/"/g, '&quot;')}" />
          </div>
        </div>
        <div class="form-row">
          <label>Correct answer</label>
          <select class="course-question-answer">
            <option value="0" ${answer === 0 ? "selected" : ""}>A</option>
            <option value="1" ${answer === 1 ? "selected" : ""}>B</option>
            <option value="2" ${answer === 2 ? "selected" : ""}>C</option>
            <option value="3" ${answer === 3 ? "selected" : ""}>D</option>
          </select>
        </div>
      </div>
    `;
  };

  // Modules come in two flavors:
  //  - "text": the instructor writes the module content directly (original behavior).
  //  - "pdf": the instructor uploads a PDF file, which is stored (as a base64
  //    data URL) on the module itself and rendered as an embedded PDF for
  //    learners on course-detail.html, instead of any extracted/typed text.
  const MODULE_PDF_MAX_BYTES = 4 * 1024 * 1024; // keep individual module PDFs modest so the course document stays well under Firestore's 1MB doc limit

  const buildModuleCard = (index, module = {}) => {
    const title = module.title || `Module ${index}`;
    const type = module.type === 'pdf' ? 'pdf' : 'text';
    const content = module.content || "";
    const pdfName = module.pdfName || "";
    const pdfData = module.pdfData || "";

    const bodyHtml = type === 'pdf'
      ? `
        <div class="form-row">
          <label>Module PDF</label>
          <input type="file" class="course-module-pdf-file" accept=".pdf,application/pdf" />
          <p class="form-note module-pdf-status" style="margin-top:0.35rem;">${pdfData ? `Current file: ${pdfName || 'module.pdf'} (uploaded)` : 'No PDF uploaded yet.'}</p>
          <input type="hidden" class="course-module-pdf-data" value="${pdfData ? pdfData.replace(/"/g, '&quot;') : ''}" />
          <input type="hidden" class="course-module-pdf-name" value="${pdfName.replace(/"/g, '&quot;')}" />
        </div>
      `
      : `
        <div class="form-row">
          <label>Module content</label>
          <textarea class="course-module-content" rows="5" placeholder="Enter module content">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        </div>
      `;

    return `
      <div class="module-card" data-module-type="${type}">
        <div class="module-card-header">
          <h3 class="module-card-title">${title}</h3>
          <span class="form-note" style="margin-right:auto; margin-left:0.75rem;">${type === 'pdf' ? '📄 PDF Module' : '📝 Text Module'}</span>
          <button type="button" class="remove-card-btn">Remove</button>
        </div>
        <div class="form-row">
          <label>Module title</label>
          <input type="text" class="course-module-title" placeholder="Enter module title" value="${title.replace(/"/g, '&quot;')}" />
        </div>
        <input type="hidden" class="course-module-type" value="${type}" />
        ${bodyHtml}
      </div>
    `;
  };

  const getModuleData = () => {
    return Array.from(moduleBuilder.querySelectorAll('.module-card')).map((card, index) => {
      const title = card.querySelector('.course-module-title')?.value.trim() || `Module ${index + 1}`;
      const type = card.dataset.moduleType === 'pdf' ? 'pdf' : 'text';
      if (type === 'pdf') {
        const pdfData = card.querySelector('.course-module-pdf-data')?.value || "";
        const pdfName = card.querySelector('.course-module-pdf-name')?.value || "";
        return {
          title,
          type: 'pdf',
          pdfData,
          pdfName,
          // Keep a short content fallback so anything that still reads
          // module.content (older views, search, etc.) shows something
          // sensible instead of blank text.
          content: pdfName ? `PDF module: ${pdfName}` : "PDF module"
        };
      }
      return {
        title,
        type: 'text',
        content: card.querySelector('.course-module-content')?.value.trim() || ""
      };
    });
  };

  const getQuizQuestionData = () => {
    return Array.from(questionBuilder?.querySelectorAll('.question-card') || []).map((card, index) => {
      const questionText = card.querySelector('.course-question-text')?.value.trim() || `Question ${index + 1}`;
      const options = Array.from(card.querySelectorAll('.course-question-option')).map((option) => option.value.trim()).filter(Boolean);
      const answer = parseInt(card.querySelector('.course-question-answer')?.value, 10);

      while (options.length < 4) {
        options.push("Option placeholder");
      }

      return {
        q: questionText,
        options,
        answer: Number.isFinite(answer) ? Math.min(Math.max(answer, 0), options.length - 1) : 0
      };
    });
  };

  const getExamQuestionData = () => {
    return Array.from(examQuestionBuilder?.querySelectorAll('.question-card') || []).map((card, index) => {
      const questionText = card.querySelector('.course-question-text')?.value.trim() || `Question ${index + 1}`;
      const options = Array.from(card.querySelectorAll('.course-question-option')).map((option) => option.value.trim()).filter(Boolean);
      const answer = parseInt(card.querySelector('.course-question-answer')?.value, 10);

      while (options.length < 4) {
        options.push("Option placeholder");
      }

      return {
        q: questionText,
        options,
        answer: Number.isFinite(answer) ? Math.min(Math.max(answer, 0), options.length - 1) : 0
      };
    });
  };


  const addModuleCard = (module = {}) => {
    const moduleCount = moduleBuilder.querySelectorAll('.module-card').length + 1;
    moduleBuilder.insertAdjacentHTML('beforeend', buildModuleCard(moduleCount, module));
    
  };

  const bindModuleRemoval = () => {
    moduleBuilder.querySelectorAll('.remove-card-btn').forEach((button) => {
      button.removeEventListener('click', handleRemoveCard);
      button.addEventListener('click', handleRemoveCard);
    });
    bindModulePdfInputs();
    // When a module is removed, update the module selects
    // keep original behavior: module removal handled by handleRemoveCard
  };

  // Wires up each PDF module card's file input so picking a PDF stores it
  // (as a base64 data URL) on that card's hidden fields, ready to be picked
  // up by getModuleData() when the course is published.
  const bindModulePdfInputs = () => {
    moduleBuilder.querySelectorAll('.course-module-pdf-file').forEach((input) => {
      input.removeEventListener('change', handleModulePdfChange);
      input.addEventListener('change', handleModulePdfChange);
    });
  };

  const handleModulePdfChange = async (event) => {
    const input = event.target;
    const card = input.closest('.module-card');
    const file = input.files?.[0];
    const status = card?.querySelector('.module-pdf-status');
    if (!card || !file) return;

    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      if (status) { status.textContent = 'Please choose a PDF file.'; status.className = 'form-note module-pdf-status error'; }
      input.value = '';
      return;
    }
    if (file.size > MODULE_PDF_MAX_BYTES) {
      if (status) { status.textContent = `That PDF is too large (max ${Math.round(MODULE_PDF_MAX_BYTES / (1024 * 1024))}MB). Please upload a smaller file.`; status.className = 'form-note module-pdf-status error'; }
      input.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dataField = card.querySelector('.course-module-pdf-data');
      const nameField = card.querySelector('.course-module-pdf-name');
      if (dataField) dataField.value = dataUrl;
      if (nameField) nameField.value = file.name;
      if (status) { status.textContent = `Current file: ${file.name} (uploaded)`; status.className = 'form-note module-pdf-status success'; }
    } catch (error) {
      console.error('Failed to read module PDF', error);
      if (status) { status.textContent = 'Unable to read that PDF. Please try again.'; status.className = 'form-note module-pdf-status error'; }
    }
  };



  const bindQuestionRemoval = (container) => {
    container?.querySelectorAll('.remove-card-btn').forEach((button) => {
      button.removeEventListener('click', handleRemoveCard);
      button.addEventListener('click', handleRemoveCard);
    });
  };

  const handleRemoveCard = (event) => {
    const card = event.target.closest('.module-card, .question-card');
    if (card) card.remove();
    updateCardHeaders();
  };

  const updateCardHeaders = () => {
    moduleBuilder.querySelectorAll('.module-card').forEach((card, index) => {
      const title = card.querySelector('.module-card-title');
      if (title) title.textContent = `Module ${index + 1}`;
    });
    questionBuilder?.querySelectorAll('.question-card').forEach((card, index) => {
      const title = card.querySelector('.question-card-title');
      if (title) title.textContent = `Question ${index + 1}`;
    });
    examQuestionBuilder?.querySelectorAll('.question-card').forEach((card, index) => {
      const title = card.querySelector('.question-card-title');
      if (title) title.textContent = `Question ${index + 1}`;
    });
  };

  const populateModules = (modules = []) => {
    moduleBuilder.innerHTML = '';
    if (!modules.length) {
      addModuleCard();
    } else {
      modules.forEach((module, idx) => addModuleCard(module));
    }
    bindModuleRemoval();
  };

  // Populate the module <select> inside each question card with current module titles
  // module-selection helper removed

  const populateCategoryOptions = (selectValue) => {
    if (!categoryInput) return;
    const previousValue = selectValue || categoryInput.value;
    // Start with categories defined in BHF_COURSES plus any saved categories
    const defaultCats = Array.from(new Set((BHF_COURSES || []).map((c) => c.category).filter(Boolean)));
    const savedCats = getSavedCategories().map((c) => c.name).filter(Boolean);
    const merged = Array.from(new Set([...defaultCats, ...savedCats]));
    // Always keep the course's own current category selectable, even if it
    // isn't (yet, or anymore) in the default/saved lists above — otherwise
    // editing a course whose category momentarily isn't in this merged list
    // would silently drop it and fall back to "Custom Programs" on save.
    if (previousValue && !merged.includes(previousValue)) {
      merged.push(previousValue);
    }
    categoryInput.innerHTML = merged.map((cat) => `<option>${cat}</option>`).join('');
    if (previousValue) {
      categoryInput.value = previousValue;
    }
  };

  // Populate category select with current categories
  populateCategoryOptions();
  // Categories now stream in live (see watchCategories()), so this
  // dropdown stays current if a category is added/removed elsewhere.
  document.addEventListener('categories:updated', () => populateCategoryOptions());

  // Let admins add a brand-new category right from the course form,
  // instead of having to go back to the Admin page first.
  const addCategoryBtn = document.getElementById('course-add-category-btn');
  const categoryNote = document.getElementById('course-category-note');

  const showCourseCategoryNote = (message, type = 'success') => {
    if (!categoryNote) return;
    categoryNote.textContent = message;
    categoryNote.className = `form-note ${type === 'success' ? 'success' : 'error'}`;
  };

  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', async () => {
      const name = window.prompt('New category name:');
      if (name === null) return; // user cancelled
      const trimmed = name.trim();
      if (!trimmed) {
        showCourseCategoryNote('Enter a category name.', 'error');
        return;
      }
      addCategoryBtn.disabled = true;
      try {
        await addSavedCategory(trimmed);
        populateCategoryOptions(trimmed);
        showCourseCategoryNote(`Category added: ${trimmed}`, 'success');
        showToast(`Category saved: ${trimmed}`, 'success');
      } catch (err) {
        console.error('Failed to add category', err);
        showCourseCategoryNote('Unable to add category. Please try again.', 'error');
      } finally {
        addCategoryBtn.disabled = false;
      }
    });
  }

  // Removing a category only makes sense (and is only permitted by the
  // Firestore rules) for admins, and only for categories that were
  // actually added through "Add Category" — the built-in categories
  // (like Information Technology) come from the
  // hard-coded BHF_COURSES catalog, not the "categories" collection, so
  // there's nothing in Firestore to delete for those and removing them
  // here would just desync the dropdown from the courses that use them.
  const removeCategoryBtn = document.getElementById('course-remove-category-btn');
  if (removeCategoryBtn) {
    if (!isAdmin()) {
      // Instructors can add categories but the Firestore rules only let
      // admins delete them, so don't show a button that would just fail.
      removeCategoryBtn.style.display = 'none';
    } else {
      removeCategoryBtn.addEventListener('click', async () => {
        const selected = categoryInput?.value || '';
        if (!selected) {
          showCourseCategoryNote('Select a category to remove first.', 'error');
          return;
        }
        const isBuiltIn = (BHF_COURSES || []).some((c) => c.category === selected);
        const isSaved = getSavedCategories().some((c) => (c.name || '').trim().toLowerCase() === selected.trim().toLowerCase());
        if (isBuiltIn && !isSaved) {
          showCourseCategoryNote(`"${selected}" is a built-in category and can't be removed.`, 'error');
          return;
        }
        const coursesUsingIt = getCourseCatalog().filter((c) => c.category === selected).length;
        const confirmMsg = coursesUsingIt
          ? `${coursesUsingIt} course(s) currently use "${selected}". Remove this category anyway? Those courses will keep showing "${selected}" until reassigned.`
          : `Remove category "${selected}"?`;
        if (!window.confirm(confirmMsg)) return;

        removeCategoryBtn.disabled = true;
        try {
          await removeSavedCategory(selected);
          populateCategoryOptions();
          showCourseCategoryNote(`Category removed: ${selected}`, 'success');
          showToast(`Category removed: ${selected}`, 'success');
        } catch (err) {
          console.error('Failed to remove category', err);
          showCourseCategoryNote('Unable to remove category. Please try again.', 'error');
        } finally {
          removeCategoryBtn.disabled = false;
        }
      });
    }
  }

  const populateQuestions = (questions = []) => {
    questionBuilder.innerHTML = '';
    if (!questions.length) {
      questionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(1));
    } else {
      questions.forEach((question, idx) => questionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(idx + 1, question)));
    }
    bindQuestionRemoval(questionBuilder);
    // ensure module selects are populated from current modules
    
  };

  const populateExamQuestions = (questions = []) => {
    examQuestionBuilder.innerHTML = '';
    if (!questions.length) {
      examQuestionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(1));
    } else {
      questions.forEach((question, idx) => examQuestionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(idx + 1, question)));
    }
    bindQuestionRemoval(examQuestionBuilder);
  };

  const normalizeImportedQuizQuestion = (item) => {
    if (typeof item === 'string') {
      return { q: item, options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'], answer: 0 };
    }
    const questionText = item?.q || item?.question || item?.prompt || item?.text || '';
    const options = Array.isArray(item?.options) ? item.options.filter((option) => typeof option === 'string' && option.trim()) : [];
    const answer = Number.isFinite(item?.answer) ? item.answer : (Number.isFinite(item?.correct) ? item.correct : 0);
    return {
      q: questionText,
      options: options.length ? options : ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
      answer: Number.isFinite(answer) ? Math.min(Math.max(answer, 0), Math.max(options.length - 1, 0)) : 0
    };
  };

  const handlePdfImport = async ({ file, target }) => {
    if (!file) return;
    const loweredName = (file.name || '').toLowerCase();
    if (loweredName.endsWith('.json')) {
      try {
        const text = await file.text();
        const parsedJson = JSON.parse(text);
        const importedQuestions = Array.isArray(parsedJson)
          ? parsedJson.map(normalizeImportedQuizQuestion)
          : (Array.isArray(parsedJson?.questions) ? parsedJson.questions.map(normalizeImportedQuizQuestion) : []);
        if (importedQuestions.length) {
          populateQuestions(importedQuestions);
          setFormNote(courseNote, 'Quiz JSON imported successfully.', 'success');
          return;
        }
      } catch (error) {
        console.error('Failed to import quiz JSON', error);
        setFormNote(courseNote, 'Unable to parse the selected quiz JSON file.', 'error');
        return;
      }
    }
    if (loweredName.endsWith('.txt')) {
      try {
        const text = await file.text();
        const importedQuestions = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => ({ q: line, options: ['True', 'False'], answer: 0 }));
        if (importedQuestions.length) {
          populateQuestions(importedQuestions);
          setFormNote(courseNote, 'Quiz text imported successfully.', 'success');
          return;
        }
      } catch (error) {
        console.error('Failed to import quiz text', error);
        setFormNote(courseNote, 'Unable to parse the selected quiz text file.', 'error');
        return;
      }
    }
    try {
      const parsedCourseData = await parseCoursePdfIntoCourseData({ file });
      if (target === 'module' && parsedCourseData?.modules?.length) {
        populateModules(parsedCourseData.modules);
        setFormNote(courseNote, 'Module PDF imported successfully.', 'success');
      }
      if (target === 'quiz' && parsedCourseData?.questions?.length) {
        populateQuestions(parsedCourseData.questions);
        setFormNote(courseNote, 'Quiz file imported successfully.', 'success');
      }
      if (target === 'exam' && parsedCourseData?.questions?.length) {
        populateExamQuestions(parsedCourseData.questions);
        setFormNote(courseNote, 'Exam file imported successfully.', 'success');
      }
      if (target === 'module' && parsedCourseData?.questions?.length && !parsedCourseData?.modules?.length) {
        populateQuestions(parsedCourseData.questions);
        setFormNote(courseNote, 'Exam content was found in the PDF and added to the form.', 'success');
      }
      if ((target === 'exam' || target === 'quiz') && parsedCourseData?.modules?.length && !parsedCourseData?.questions?.length) {
        populateModules(parsedCourseData.modules);
        setFormNote(courseNote, 'Module content was found in the PDF and added to the form.', 'success');
      }
      if (!parsedCourseData?.modules?.length && !parsedCourseData?.questions?.length) {
        setFormNote(courseNote, 'No course, module, or quiz content could be detected in that file.', 'error');
      }
    } catch (error) {
      console.error('Failed to import quiz content', error);
      setFormNote(courseNote, 'Unable to import the selected file. Please try another quiz file.', 'error');
    }
  };

  modulePdfInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handlePdfImport({ file, target: 'module' });
  });

  quizPdfInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handlePdfImport({ file, target: 'quiz' });
  });

  examPdfInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handlePdfImport({ file, target: 'exam' });
  });
  questionBuilder.hidden = false;
  examQuestionBuilder.hidden = false;

  const addModuleBtn = document.getElementById('add-module-btn');
  const addPdfModuleBtn = document.getElementById('add-pdf-module-btn');
  const addModuleBottomBtn = document.getElementById('add-module-bottom-btn');
  const addPdfModuleBottomBtn = document.getElementById('add-pdf-module-bottom-btn');
  const addTextModuleHandler = () => {
    addModuleCard({ type: 'text' });
    bindModuleRemoval();
    updateCardHeaders();
  };
  const addPdfModuleHandler = () => {
    addModuleCard({ type: 'pdf' });
    bindModuleRemoval();
    updateCardHeaders();
  };

  if (addModuleBtn) {
    addModuleBtn.addEventListener('click', addTextModuleHandler);
  }
  if (addModuleBottomBtn) {
    addModuleBottomBtn.addEventListener('click', addTextModuleHandler);
  }

  if (addPdfModuleBtn) {
    addPdfModuleBtn.addEventListener('click', addPdfModuleHandler);
  }
  if (addPdfModuleBottomBtn) {
    addPdfModuleBottomBtn.addEventListener('click', addPdfModuleHandler);
  }

  if (addQuestionBtn) {
    addQuestionBtn.addEventListener('click', () => {
      const questionCount = questionBuilder.querySelectorAll('.question-card').length + 1;
      questionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(questionCount));
      bindQuestionRemoval(questionBuilder);
      updateCardHeaders();
    });
  }

  if (addExamQuestionBtn) {
    addExamQuestionBtn.addEventListener('click', () => {
      const questionCount = examQuestionBuilder.querySelectorAll('.question-card').length + 1;
      examQuestionBuilder.insertAdjacentHTML('beforeend', buildQuestionCard(questionCount));
      bindQuestionRemoval(examQuestionBuilder);
      updateCardHeaders();
    });
  }

  const loadEditableCourse = async () => {
    await (window.dataReadyPromise || Promise.resolve());
    const editKey = new URLSearchParams(window.location.search).get('edit');
    if (!editKey) return;

    // Try to load the course from the merged catalog (defaults + saved overrides).
    // This allows editing built-in courses (defined in BHF_COURSES) even if they
    // haven't been saved to Firestore yet — an override document will be created
    // when the admin saves the edited course.
    const allCourses = getCourseCatalog();
    const savedCourse = allCourses.find((c) => normalizeCourseTitle(c.title) === normalizeCourseTitle(editKey));
    if (!savedCourse) return;

    titleInput.value = savedCourse.title || '';
    // Refresh the dropdown's options now that categoriesCache has fully
    // loaded (dataReadyPromise resolved above) — otherwise this course's
    // real category might not exist as an <option> yet, the assignment
    // below would silently no-op, and re-saving would fall back to
    // "Custom Programs" instead of keeping the course's actual category.
    populateCategoryOptions(savedCourse.category);
    categoryInput.value = savedCourse.category || '';
    // Accept either `description` or legacy `desc` from defaults
    descriptionInput.value = savedCourse.description || savedCourse.desc || '';
    if (levelInput) levelInput.value = savedCourse.level || 'Intermediate';
    // Infer the correct Free/Paid toggle state when loading a course for
    // editing. Previously this defaulted to "free" any time accessRule
    // wasn't explicitly "paid" — which silently flipped level-based paid
    // courses (Intermediate/Advanced with no accessRule field yet) to
    // free the moment someone opened and re-saved them, breaking payment
    // gating. Now it falls back to the same free/paid inference used by
    // courseRequiresPayment()/getCourseAccessRule() everywhere else in
    // the app, so a paid course stays paid unless someone deliberately
    // switches the toggle.
    const inferredAccessRule = (savedCourse.accessRule === 'paid' || savedCourse.accessRule === 'free')
      ? savedCourse.accessRule
      : ((savedCourse.level || 'Intermediate').toLowerCase() === 'beginner' ? 'free' : 'paid');
    setAccessRule(inferredAccessRule);
    imageInput.value = savedCourse.img || savedCourse.image || '';
    if (imagePreview && imageInput.value) {
      imagePreview.src = imageInput.value;
      imagePreview.style.display = 'block';
    }
    // Note: materials-URL editing lives on a different admin page, not here —
    // this field was removed from add-course.html but a stray reference to it
    // remained, throwing a ReferenceError that aborted the rest of this
    // function (including populating modules/quiz/exam) whenever the page
    // loaded in edit mode (?edit=...).

    if (savedCourse.modules && savedCourse.modules.length) {
      populateModules(savedCourse.modules);
    } else {
      // No auto-generated filler modules — start blank so it's obvious
      // nothing has actually been written for this course yet.
      populateModules([]);
    }

    if (savedCourse.quizQuestions && savedCourse.quizQuestions.length) {
      populateQuestions(savedCourse.quizQuestions);
    } else if (savedCourse.questions && savedCourse.questions.length) {
      populateQuestions(savedCourse.questions);
    } else {
      populateQuestions([]);
    }

    if (savedCourse.examQuestions && savedCourse.examQuestions.length) {
      populateExamQuestions(savedCourse.examQuestions);
    } else if (savedCourse.questions && savedCourse.questions.length) {
      populateExamQuestions(savedCourse.questions);
    } else {
      populateExamQuestions([]);
    }
  };

  if (typeof loadEditableCourse === 'function') {
    loadEditableCourse().then(() => {
      const focusParam = new URLSearchParams(window.location.search).get('focus');
      if (focusParam === 'modules') {
        const moduleHeader = document.querySelector('.module-builder-header');
        if (moduleHeader) {
          const banner = document.createElement('p');
          banner.className = 'form-note success';
          banner.textContent = 'Editing Modules and Exam questions for this course. Scroll down to update them, then click Publish Course.';
          moduleHeader.parentElement?.insertBefore(banner, moduleHeader);
          moduleHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  }

  courseForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!titleInput) return;

    const title = titleInput.value.trim();
    const category = categoryInput?.value?.trim() || '';
    const description = descriptionInput?.value.trim() || 'No description provided for this course yet.';
    const editKeyForOwner = new URLSearchParams(window.location.search).get('edit');
    const existingForOwner = editKeyForOwner && typeof findSavedCourse === 'function' ? findSavedCourse(editKeyForOwner) : null;
    // An uploaded thumbnail file takes priority over a pasted URL. Falls
    // back to whatever image was already saved for this course when
    // editing (so re-publishing without touching the thumbnail doesn't
    // wipe it back to the generic stock photo), and only uses the stock
    // photo as a last resort for a brand-new course with no image at all.
    const uploadedImageFile = imageFileInput?.files?.[0] || null;
    const image = uploadedImageFile
      ? await readFileAsDataUrl(uploadedImageFile)
      : (imageInput?.value.trim()
          || existingForOwner?.img
          || 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=900&q=80');
    // Validate admin-provided image URLs (accept http(s) and data URLs).
    if (image && !isValidImageUrl(image)) {
      setFormNote(courseNote, 'Please enter a valid image URL (http, https, or data).', 'error');
      return;
    }
    const level = levelInput?.value || 'Intermediate';
    const examEnabled = true;

    if (!title) {
      setFormNote(courseNote, 'Enter a course title before saving.', 'error');
      return;
    }

    if (!category || !category.trim()) {
      setFormNote(courseNote, 'Select a category before publishing.', 'error');
      return;
    }

    // Require every module card to actually have a title and content —
    // getModuleData() below fills in placeholder titles like "Module 1"
    // for blank cards, which would otherwise let an empty module through.
    const moduleCardsCheck = Array.from(moduleBuilder?.querySelectorAll('.module-card') || []);
    const hasIncompleteModule = moduleCardsCheck.length === 0 || moduleCardsCheck.some((card) => {
      const moduleTitle = card.querySelector('.course-module-title')?.value.trim() || '';
      if (!moduleTitle) return true;
      if (card.dataset.moduleType === 'pdf') {
        const pdfData = card.querySelector('.course-module-pdf-data')?.value || '';
        return !pdfData;
      }
      const moduleContent = card.querySelector('.course-module-content')?.value.trim() || '';
      return !moduleContent;
    });
    if (hasIncompleteModule) {
      setFormNote(courseNote, 'Add at least one module — Text Modules need a title and content, PDF Modules need a title and an uploaded PDF — before publishing.', 'error');
      return;
    }

    // Same idea for quiz questions: require question text plus at least
    // two real (non-blank) answer options, rather than letting a blank
    // card through with auto-filled "Option placeholder" text.
    const quizCardsCheck = Array.from(questionBuilder?.querySelectorAll('.question-card') || []);
    const hasIncompleteQuiz = quizCardsCheck.length === 0 || quizCardsCheck.some((card) => {
      const questionText = card.querySelector('.course-question-text')?.value.trim() || '';
      const filledOptions = Array.from(card.querySelectorAll('.course-question-option'))
        .map((option) => option.value.trim())
        .filter(Boolean);
      return !questionText || filledOptions.length < 2;
    });
    if (hasIncompleteQuiz) {
      setFormNote(courseNote, 'Add at least one quiz question with text and at least two answer options before publishing.', 'error');
      return;
    }

    // And the exam question builder.
    const examCardsCheck = Array.from(examQuestionBuilder?.querySelectorAll('.question-card') || []);
    const hasIncompleteExam = examCardsCheck.length === 0 || examCardsCheck.some((card) => {
      const questionText = card.querySelector('.course-question-text')?.value.trim() || '';
      const filledOptions = Array.from(card.querySelectorAll('.course-question-option'))
        .map((option) => option.value.trim())
        .filter(Boolean);
      return !questionText || filledOptions.length < 2;
    });
    if (hasIncompleteExam) {
      setFormNote(courseNote, 'Add at least one exam question with text and at least two answer options before publishing.', 'error');
      return;
    }

    // Preserve the original owner on edit; tag new courses created by an
    // instructor with their uid so they only ever see/manage their own work.
    // Admins can optionally take ownership by not including instructorId/Name
    let instructorId = existingForOwner?.instructorId;
    let instructorName = existingForOwner?.instructorName;
    
    if (!isAdmin()) {
      // Instructors: always set their own ID on new courses
      if (!instructorId && isInstructor()) {
        instructorId = currentUser?.uid;
        instructorName = currentUser?.name;
      }
    }
    // For admins editing instructor courses: instructorId stays (preserve ownership)
    // Admins who want to take ownership should clear the instructorId field manually

    const quizQuestions = getQuizQuestionData();
    const examQuestions = getExamQuestionData();
    // No per-module quiz mapping (module assignment was removed)

    const course = {
      title,
      category,
      description,
      img: image,
      examEnabled,
      modules: getModuleData(),
      quizQuestions,
      examQuestions,
      questions: examEnabled ? examQuestions : [],
      level,
      duration: '4 Weeks',
      accessRule: accessRuleInput?.value === 'paid' ? 'paid' : 'free',
      active: true,
      // Firestore's addDoc/updateDoc throws if a field's value is the
      // literal `undefined` (as opposed to the field being absent
      // entirely) — e.g. "Unsupported field value: undefined". Admin
      // accounts (as opposed to instructors) legitimately have no
      // instructorId/instructorName, so those used to be set to
      // `undefined` here and silently broke every course save for admins,
      // surfacing only as the generic "Unable to save the course" catch
      // below. Only include these keys at all when there's a real value.
      ...(instructorId ? { instructorId } : {}),
      ...(instructorName ? { instructorName } : {})
    };

    try {
      const editKey = new URLSearchParams(window.location.search).get('edit');
      if (editKey) {
        // Try to update an existing Firestore record. If none exists yet (editing
        // a built-in default course), create a new saved override document instead.
        const updated = await updateSavedCourse(editKey, course);
        if (updated) {
          setFormNote(courseNote, `Course "${title}" has been updated successfully.`, 'success');
          showToast(`Updated course: ${title}`, 'success');
        } else {
          await addSavedCourse(course);
          setFormNote(courseNote, `Course "${title}" has been saved as an override.`, 'success');
          showToast(`Saved course override: ${title}`, 'success');
        }
      } else {
        await addSavedCourse(course);
        setFormNote(courseNote, `Course "${title}" has been saved successfully.`, 'success');
        showToast(`Saved course: ${title}`, 'success');
      }

      window.setTimeout(() => {
        window.location.href = isInstructor() ? 'instructor.html' : 'manage-courses.html';
      }, 900);
    } catch (error) {
      console.error('Failed to save course to Firestore', error);
      const detail = error?.message ? ` (${error.message})` : '';
      setFormNote(courseNote, `Unable to save the course. Please try again.${detail}`, 'error');
    }
  });
}

if (page === "manage-courses") {
  await authReadyPromise;
  const auth = getAuth();
  if (!auth) {
    window.location.href = "login.html";
    return;
  } else if (!isAdmin()) {
    window.location.href = "dashboard.html";
    return;
  }

  const adminCourseList = document.getElementById('admin-course-list');
  const categorySelect = document.getElementById('manage-category-select');
  const focusMode = new URLSearchParams(window.location.search).get('focus') === 'modules';
  const publishedOnlyMode = new URLSearchParams(window.location.search).get('view') === 'published';
  let selectedCategory = '';

  const populateManageCategoryOptions = () => {
    if (!categorySelect) return;
    const defaultCats = Array.from(new Set((BHF_COURSES || []).map((c) => c.category).filter(Boolean)));
    const savedCats = getSavedCategories().map((c) => c.name).filter(Boolean);
    const merged = Array.from(new Set([...defaultCats, ...savedCats]));
    categorySelect.innerHTML = `<option value="">All categories</option>` +
      merged.map((cat) => `<option value="${cat}">${cat}</option>`).join('');
  };

  const renderManageCourses = async () => {
    await (window.dataReadyPromise || Promise.resolve());
    if (!adminCourseList) return;
    
    // Use the same approach as programs page: use mergeCoursesWithSaved
    // which combines BHF_COURSES with saved courses and filters actives
    const all = typeof mergeCoursesWithSaved === 'function' 
      ? mergeCoursesWithSaved(
          typeof BHF_COURSES !== "undefined" && Array.isArray(BHF_COURSES)
            ? BHF_COURSES.map((course) => ({
                title: course.title,
                description: course.description || course.desc || "Professional certification course for continued learning.",
                level: course.level || "Intermediate",
                duration: course.duration || "4 Weeks",
                category: course.category || "General",
                img: course.img || course.image
              }))
            : []
        )
      : getSavedCourses();
    
    // Show ALL courses by default (both built-in and saved)
    // Only filter to published when explicitly requested
    const scoped = publishedOnlyMode ? all.filter((course) => Boolean(course.id)) : all;
    const filtered = selectedCategory
      ? scoped.filter((course) => (course.category || 'General') === selectedCategory)
      : scoped;

    const heading = focusMode ? 'Edit Modules and Exam' : (publishedOnlyMode ? 'My Published Courses' : 'All Courses');

    if (!filtered.length) {
      adminCourseList.innerHTML = `
        <h2>${heading}</h2>
        <p class="form-note">${selectedCategory ? `No courses found in "${selectedCategory}" yet.` : (publishedOnlyMode ? "You haven't published any courses yet. Use Add Program to publish one." : 'No courses found yet.')}</p>
      `;
      return;
    }

    adminCourseList.innerHTML = `
      <h2>${heading}</h2>
      <div class="course-grid admin-course-grid">
        ${filtered
          .map((course) => {
            const activeLabel = course.active ? 'Active' : 'Inactive';
            const buttonText = course.active ? 'Disable' : 'Activate';
            const editLabel = focusMode ? 'Edit Modules &amp; Exam' : 'Edit';
            const editHref = focusMode
              ? `add-course.html?edit=${encodeURIComponent(course.title)}&focus=modules`
              : `add-course.html?edit=${encodeURIComponent(course.title)}`;
            // Toggle/Delete act on Firestore records; built-in default courses
            // that haven't been saved yet don't have an `id`, so hide those
            // two actions for them (editing one will create a saved copy).
            const manageActions = course.id
              ? `
                <button class="btn btn-secondary" type="button" data-action="toggle-active" data-title="${course.title}">${buttonText}</button>
                <button class="btn btn-secondary" type="button" data-action="delete-course" data-title="${course.title}">Delete</button>
              `
              : `<span class="pill">Built-in default</span>`;
            return `
              <article class="course-card admin-course-card">
                <div class="course-body">
                  <span class="pill">${course.category || 'General'}</span>
                  ${course.instructorId ? `<span class="pill" style="background:#eef2ff;color:#3730a3;">👤 ${escapeHtml(course.instructorName || 'Instructor')}</span>` : ''}
                  <h3>${course.title}</h3>
                  <p>${course.description || 'No description provided.'}</p>
                  <div class="course-meta">
                    <span class="pill">${course.level || 'Intermediate'}</span>
                    <span class="pill">${course.duration || '4 Weeks'}</span>
                    <span class="pill ${course.active ? 'pill-active' : 'pill-inactive'}">${activeLabel}</span>
                  </div>
                </div>
                <div class="course-actions admin-course-actions">
                  <a class="btn btn-secondary" href="course-detail.html?course=${encodeURIComponent(course.title)}&category=${encodeURIComponent(course.category)}">Preview</a>
                  <a class="btn btn-primary" href="${editHref}">${editLabel}</a>
                  ${manageActions}
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  };

  categorySelect?.addEventListener('change', () => {
    selectedCategory = categorySelect.value;
    renderManageCourses().catch((err) => console.error('Failed to render manage courses', err));
  });

  adminCourseList?.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    const title = button.dataset.title;
    if (!action || !title) return;

    button.disabled = true;

    if (action === 'toggle-active') {
      const course = findSavedCourse(title);
      if (!course) { button.disabled = false; return; }
      const wasActive = course.active;
      await updateSavedCourse(title, { active: !wasActive });
      showToast(`${course.title} is now ${wasActive ? 'disabled' : 'active'}.`, 'success');
      renderManageCourses().catch((err) => console.error('Failed to render manage courses', err));
    }

    if (action === 'delete-course') {
      const confirmed = window.confirm(`Delete the course "${title}" from the catalog?`);
      if (!confirmed) { button.disabled = false; return; }
      await removeSavedCourse(title);
      showToast(`Course deleted: ${title}`, 'info');
      renderManageCourses().catch((err) => console.error('Failed to render manage courses', err));
    }
  });

  populateManageCategoryOptions();
  renderManageCourses().catch((err) => console.error('Failed to render manage courses', err));
}

// Initialize programs page if on programs.html
if (page === "programs") {
  // Wait a moment for DOM to settle, then initialize programs page functions
  const initializePrograms = async () => {
    try {
      await (window.dataReadyPromise || Promise.resolve());
      // NOTE: window.renderDepartments() used to be called here too, but
      // that's the OLD hardcoded 4-category version defined inline in
      // programs.html (only the hard-coded BHF_COURSES categories, and no
      // admin/instructor-added categories). This block
      // runs via a microtask/DOMContentLoaded AFTER renderProgramsOverview()
      // above already built the correct, live "#departments" cards from
      // BHF_COURSES + Firestore categories, so calling the old function
      // here was silently overwriting the correct list with the stale
      // one — which is why newly published categories never appeared on
      // this page even though they saved successfully. Removed.
      if (typeof window.bindCourseModalActions === 'function') window.bindCourseModalActions();
      if (typeof window.renderCourses === 'function') window.renderCourses(window.currentCourseDept);
    } catch (e) {
      console.error('Failed to initialize programs page:', e);
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePrograms);
  } else {
    // DOM is already loaded, call immediately but in a microtask to ensure inline script has executed
    Promise.resolve().then(initializePrograms);
  }
}
}/* ==========================================================================
   BHF Certification Academy - Main Script
   ========================================================================== */

// ... (Your original script content starts here) ...
// I will include the logic to append the new functionality at the end.

/* [Original Code Snippet - First 500 lines for context] */

// ... (Rest of your 5700+ lines of code) ...

/* ==========================================================================
   NEW: ADMIN DASHBOARD INSTRUCTOR ACTIONS
   ========================================================================== */

if (document.body.dataset.page === "admin-dashboard") {
  const initAdminDashboardActions = async () => {
    const btnAddInstructor = document.getElementById("btn-add-instructor");
    const instructorModal = document.getElementById("instructor-modal");
    const closeInstructorModal = document.getElementById("close-instructor-modal");
    const cancelInstructor = document.getElementById("cancel-instructor");
    const addInstructorForm = document.getElementById("add-instructor-form");

    if (!btnAddInstructor || !instructorModal) return;

    const openModal = () => {
      instructorModal.style.display = "flex";
      document.body.style.overflow = "hidden";
    };

    const closeModal = () => {
      instructorModal.style.display = "none";
      document.body.style.overflow = "auto";
      if (addInstructorForm) addInstructorForm.reset();
    };

    btnAddInstructor.addEventListener("click", openModal);
    if (closeInstructorModal) closeInstructorModal.addEventListener("click", closeModal);
    if (cancelInstructor) cancelInstructor.addEventListener("click", closeModal);

    window.addEventListener("click", (e) => {
      if (e.target === instructorModal) closeModal();
    });

    if (addInstructorForm) {
      addInstructorForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const submitBtn = addInstructorForm.querySelector('button[type="submit"]');
        const name = document.getElementById("instructor-name")?.value.trim();
        const email = document.getElementById("instructor-email")?.value.trim().toLowerCase();
        const specialization = document.getElementById("instructor-specialization")?.value.trim();
        const isActive = document.getElementById("instructor-status")?.value === "true";

        if (!name || !email) {
          alert("Please provide at least a name and email.");
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Creating Account...";

        try {
          const tempPassword = "BHF" + Math.random().toString(36).slice(-8);

          // Call your existing global function
          if (typeof createInstructorAccount === "function") {
            const uid = await createInstructorAccount({
              name,
              email,
              password: tempPassword
            });

            // Update specialization and extra fields if needed
            if (specialization) {
              await updateDoc(doc(db, "instructors", uid), {
                specialization: specialization,
                active: isActive
              });
            }

            alert(`Instructor account created successfully!\n\nName: ${name}\nEmail: ${email}\nTemp Password: ${tempPassword}\n\nPlease share this password with the instructor.`);
            
            window.location.reload(); 
          } else {
            throw new Error("createInstructorAccount function not found in script.js");
          }

          closeModal();
        } catch (error) {
          console.error("Error creating instructor:", error);
          alert("Error: " + error.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Save Instructor";
        }
      });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminDashboardActions);
  } else {
    initAdminDashboardActions();
  }
}