# Firebase Setup — one-time steps in the Firebase Console

Your code is now wired to Firebase. Before it will work, do these three things
in the Firebase Console (console.firebase.google.com → your project
`bhf-training-and-certificate`):

## 1. Turn on Email/Password sign-in
Authentication → Sign-in method → Email/Password → Enable → Save.

## 2. Create the admin account
Authentication → Users → Add user
- Email: `admin@bhf.com`
- Password: pick a real, strong password (the old hardcoded `123456` is gone)

That's it — `admin@bhf.com` is automatically treated as admin everywhere in
the app (add-course.html, manage-courses.html, admin.html) because the code
checks for that exact email. No separate "role" field needed.

## 3. Create the Firestore database + apply the rules
- Firestore Database → Create database → Start in production mode → pick a
  region close to your users.
- Once created, go to the **Rules** tab and paste in the contents of
  `firestore.rules` (included in this download), then **Publish**.

That's the whole backend setup. Courses added through `add-course.html` now
write to a `courses` collection in Firestore instead of the browser's
localStorage, so they'll show up for every visitor, on every device.

---

## What changed in the code
- **New file `firebase-init.js`** — initializes Firebase Auth + Firestore.
- **`script.js`** — the old fake `localStorage` account system
  (`bhf_user_database`, `bhf_auth`) is gone. Signup/login/logout now go
  through real Firebase Authentication. The course catalog
  (`bhf_course_catalog`) now lives in Firestore instead of localStorage.
- Every page's `<script src="script.js">` is now
  `<script type="module" src="script.js">` (required so it can `import`
  Firebase).
- Removed the old "Admin Access" one-click demo login button on the login
  page — it bypassed real authentication. Now the admin just signs in with
  `admin@bhf.com` + the real password from step 2 above, on the normal login
  form.
- **Certificates now live in Firestore** (`certificates` collection) instead
  of `localStorage`. When a learner passes an exam on `course-detail.html`,
  their certificate is written to Firestore. The homepage "Verify
  Certificate" tool now looks certificates up live from Firestore by code,
  and renders the actual certificate design (not just a text summary) — so a
  certificate issued on one device now verifies correctly from any other
  device or browser, which was the whole point of the tool.
- Because of the certificates change above, **you must re-publish
  `firestore.rules`** (Firestore Database → Rules tab → paste the updated
  contents of `firestore.rules` → Publish) or certificate creation and
  verification will fail with a "permission denied" error.

## What's still on localStorage (not migrated yet)
To keep this change reviewable, I left these as they were — they're lower
risk, since they don't gate access to anything:
- **Enrollments** (`bhf_user_enrollments`) — which courses a user clicked
  "Enroll" on.
- **Course progress** (`bhf_progress_*`) — per-module completion state on
  the course player.
- **Admin content overrides** (`bhf_admin_content`) — the admin.html text
  editor.

These still work, but they're per-browser, not shared across devices. If you
want, I can migrate these to Firestore next using the same pattern.

## Testing locally
Because `script.js` is now an ES module, opening `index.html` directly from
disk (`file://...`) won't work in most browsers — modules require a real
server. Run a local server from the project folder, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000/index.html`.
