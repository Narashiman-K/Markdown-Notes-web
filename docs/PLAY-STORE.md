# Publishing to Google Play

Everything needed to get **Suprasūtā Markdown Notes** onto the Play Store, in
the order it has to happen.

Read the timeline section first. The build is the easy part; the waiting is not.

---

## 0. Timeline, before you start

A personal Play developer account opened after November 2023 cannot publish
straight to production. Google requires a **closed test with at least 12 testers
who stay opted in for 14 continuous days**, and only then will it accept an
application for production access.

So the realistic shape of this is:

| Stage | Elapsed |
| --- | --- |
| Create account, identity verification | 1–3 days |
| Build, upload, complete the listing | 1 day |
| Internal testing (up to 100 testers, no wait) | same day |
| Closed test running with 12+ testers | **14 days minimum** |
| Apply for production access, Google reviews | 1–7 days |
| Production review of the release itself | 1–7 days |

**Roughly three to four weeks.** Start recruiting the 12 testers now — they need
Google accounts, and each must actually install the app and leave it installed.
Family, friends and colleagues all count; they do not need to use it seriously.

---

## 1. Create the upload keystore

This is the one irreplaceable thing in this document. If you lose this file or
its password, **you can never update the app again** — you would have to publish
a new listing under a new package name and lose your users and reviews.

Run this on your own machine, in a folder that is **not** inside the repository:

```powershell
cd "D:\Calude Co-work space"
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v `
  -keystore suprasuta-upload.jks `
  -alias suprasuta `
  -keyalg RSA -keysize 4096 -validity 10000 `
  -storetype JKS
```

If `JAVA_HOME` is not set, use the `keytool.exe` inside any Android Studio or
JDK installation.

It will ask for a password and then for name, organisation, city, and country.
The details only appear inside the certificate, not on your listing — but use
real ones.

> **Password:** choose something long, and **avoid backslashes** — the CI build
> reads the password from a Java properties file, where `\` is an escape
> character and would silently corrupt it.

Then back it up in at least two places you control — a password manager entry
and an encrypted drive, for example. Not in the repository, and not anywhere
that syncs to a public location.

### Why this key, and not Google's

Play App Signing means Google holds the *app signing key* used for the version
that reaches phones. The key you just made is the *upload key* — it only proves
that a bundle came from you. If it is ever compromised you can ask Google to
reset it, which is exactly why the two are separate. Accept Play App Signing
when it is offered.

---

## 2. Put the keystore into GitHub as secrets

The release build runs in GitHub Actions, so it needs the keystore. Encode it:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\Calude Co-work space\suprasuta-upload.jks")) `
  | Set-Content -NoNewline keystore.b64
```

Open `keystore.b64`, copy the whole thing, then delete the file.

In the repository → **Settings → Secrets and variables → Actions → New
repository secret**, add four:

| Secret name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text you just copied |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `suprasuta` |
| `ANDROID_KEY_PASSWORD` | the key password (the same one, unless you set a separate one) |

GitHub masks these in logs and will not show them again after you save.

---

## 3. Build the signed bundle

The release job only runs on a version tag, so a normal push cannot burn a
version number:

```powershell
cd "D:\Calude Co-work space\Build Projects\MarkNote-Web-Mobile"
git tag v1.0.0
git push origin v1.0.0
```

Watch **Actions → Build → release**. When it finishes, download the
**`play-release`** artifact. It contains two files:

- `app-release.aab` — this is what you upload to Play
- `app-release.apk` — the same code as an installable file, for testing on a
  real phone or emulator before you upload anything

The job includes a step that prints the signing certificate. Confirm it does
**not** say `CN=Android Debug` — a debug-signed upload is the most common reason
a first submission is rejected.

### About version numbers

`versionName` comes from the tag (`v1.0.0` → `1.0.0`). `versionCode` comes from
the GitHub Actions run number, which only ever increases. Play rejects any
bundle whose version code is not higher than the last one uploaded, so never try
to reuse a tag.

---

## 4. Test the APK before you upload

Install `app-release.apk` on a real device or an emulator:

```powershell
adb install -r app-release.apk
```

Work through this list. Anything here that fails is far cheaper to find now than
after a review.

- [ ] The app icon on the home screen is the Suprasūtā mark, not the default
- [ ] The splash screen appears and is not stretched
- [ ] Create a document, type, save, reopen it
- [ ] Highlight some text, add a comment, confirm both survive a save and reload
- [ ] Convert a PDF and a Word file
- [ ] **Turn on aeroplane mode**, then convert an image with *offline* OCR — it
      must work with no connection
- [ ] Export a file and confirm the Android share sheet appears
- [ ] Rotate the screen; check nothing is cut off
- [ ] Check dark mode
- [ ] Press Back from the main screen — it should not lose unsaved work silently

---

## 5. Create the app in Play Console

**Create app**, then:

| Field | Value |
| --- | --- |
| App name | Suprasūtā Markdown Notes |
| Default language | English (United Kingdom) |
| App or game | App |
| Free or paid | Free |

Note that **free cannot be changed to paid later**. Given the licence is
personal, non-commercial use, free is the right answer.

---

## 6. Store listing copy

Ready to paste. Adjust to taste, but keep the claims accurate — Google checks
that the description matches what the app does.

### App name (30 characters max)

```
Suprasuta Markdown Notes
```

### Short description (80 characters max)

```
Read, annotate and convert documents. Private by design, works offline.
```

### Full description (4000 characters max)

```
Suprasuta Markdown Notes is a document reader, editor and annotator that keeps
your files on your own device.

READ AND ANNOTATE
Open Markdown documents and mark them up the way you would mark up paper —
highlights in four colours, underline, strikethrough and comments. Annotations
are written into the document itself as standard HTML, so the file stays
portable and readable in any other Markdown tool.

EDIT
A proper source editor with syntax highlighting, a formatting bar that appears
when you select text, find, undo and redo, an outline view for long documents,
and light and dark themes.

CONVERT ALMOST ANYTHING TO MARKDOWN
PDF, Word, Excel, PowerPoint, OpenDocument text and spreadsheets, EPUB, CSV and
plain text — all converted inside the app. Your files are never uploaded to be
converted. Images can be read with optical character recognition that also runs
entirely on your device, with no connection required.

ASK YOUR DOCUMENTS
An optional AI assistant answers questions using only the documents you have
loaded, citing where each answer came from and saying plainly when the documents
do not contain the answer, instead of guessing. It is off until you enable it
with your own API key from Anthropic, OpenAI or Google.

PRIVATE BY DESIGN
There is no account, no sign-in, no analytics and no advertising. Your
documents, annotations and settings never leave your device. The only features
that use the network are the optional AI assistant, cloud image recognition and
audio transcription, each off by default and each using an API key you provide
yourself. API keys are encrypted before they are stored.

WORKS OFFLINE
The whole app is installed on your phone. Reading, editing, annotating,
converting documents and offline text recognition all work with no connection.

Also available for Windows and in any web browser, with the same documents and
the same annotations.

Free for personal, non-commercial use.

Created by Narashiman Krishnamurthy.
```

### Graphics you need to produce

| Asset | Size | Notes |
| --- | --- | --- |
| App icon | 512 × 512 PNG | Use `assets/icon.png`, resized |
| Feature graphic | 1024 × 500 PNG | Required. Logo on black with the app name |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | Take on the emulator |
| Tablet screenshots | optional | Only if you declare tablet support |

Good screenshots to take, in this order: a document with colourful annotations
visible; the edit view with the formatting bar showing; the convert dialog with
the format list; the AI panel showing an answer with citations; the outline
sidebar on a long document.

---

## 7. Content rating

Complete the questionnaire under **Policy → App content**. For this app the
honest answers give a rating of *Everyone* / *PEGI 3*:

- Violence, sexuality, profanity, drugs, gambling — **No** to all
- Does the app allow users to interact or share content? — **No** (there is no
  social or sharing feature between users; the Android share sheet is the
  operating system's own)
- Does the app share the user's location? — **No**
- Does the app allow purchases? — **No**

---

## 8. Data safety declaration

This is the section most likely to cause a rejection if answered carelessly.
Google's question is whether **your app** collects or shares data, meaning data
sent to you or to a third party you have integrated.

**Does your app collect or share any of the required user data types?**

> **Yes** — because of the optional AI, OCR and transcription features. Do not
> answer No. Answering No while the app can transmit user content to a third
> party is exactly the kind of mismatch that gets an app suspended.

Then declare:

| Question | Answer |
| --- | --- |
| Data type | **Files and docs** |
| Collected | No |
| Shared | **Yes** |
| Purpose | App functionality |
| Is sharing optional? | **Yes — users can choose whether this data is shared** |
| Processed ephemerally? | Yes |
| Is all data encrypted in transit? | **Yes** (every provider is HTTPS) |
| Can users request deletion? | **Yes** |

Declare nothing else. Specifically: no personal info, no location, no contacts,
no identifiers, no app activity, no crash logs — the app has no analytics or
crash reporting of any kind.

In the free-text explanation, this wording is accurate:

```
The app functions entirely on-device by default. Three optional features can
send user-selected content to a third-party provider, and only after the user
supplies their own API key for that provider: an AI assistant (document
excerpts), cloud image recognition (the selected image) and audio transcription
(the selected audio file). The app has no account system, no analytics and no
advertising, and the developer receives no user data at any point.
```

**Privacy policy URL:**

```
https://markdown-notes-psi.vercel.app/privacy.html
```

---

## 9. Other declarations

- **Ads:** No, this app contains no ads
- **Target audience:** 18 and over (avoids the extra Families policy
  requirements; the app is a document tool with no child-directed content)
- **News app:** No
- **COVID-19 contact tracing:** No
- **Government app:** No
- **Financial features:** None
- **Data deletion:** point to the privacy policy URL above, which explains that
  uninstalling removes everything

---

## 10. Release to a closed test

1. **Testing → Internal testing** first. Upload the AAB, add your own email,
   install from the opt-in link. This has no waiting period and catches obvious
   problems fast.
2. Then **Testing → Closed testing → Create track**. Create an email list with
   your 12+ testers and send them the opt-in link.
3. Every tester must accept the invitation and install the app. Google counts
   testers who are *opted in*, so ask them not to leave the programme.
4. Leave it running **14 continuous days**. The counter resets if you drop below
   12 testers.
5. After 14 days, **Apply for production access**. Google asks what you tested
   and what you learned — answer specifically. Vague answers get rejected here.

---

## 11. Production

Once production access is granted: **Production → Create new release**, upload
the same AAB (or a newer one), write release notes, roll out.

Consider a **staged rollout** at 20% for the first release, so a serious problem
reaches only a fraction of users before you can halt it.

---

## Common rejection reasons, and whether they apply here

| Reason | Status |
| --- | --- |
| Debug-signed upload | Handled — the release job signs with your upload key |
| Not an AAB | Handled — the job produces `.aab` |
| targetSdk too low | Handled — Capacitor 8 targets API 36, the requirement from 31 Aug 2026 |
| Missing privacy policy | Handled — `public/privacy.html`, live and linked in the app |
| Data safety mismatch | Handled if you follow section 8 exactly |
| Default or placeholder icon | Handled — icons are generated from the logo during the build |
| Broken functionality on review devices | **Your risk.** Work through section 4 |
| Description promising things the app does not do | **Your risk.** The copy above is deliberately accurate |

---

## Updating later

```powershell
git tag v1.0.1
git push origin v1.0.1
```

Download the new artifact, upload it to the production track, write release
notes. The version code increases automatically.
