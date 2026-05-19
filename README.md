# leo-ricci.com

Personal website and Shotgun AI product site, deployed via Firebase Hosting.

## Structure

```
site/           → leo-ricci.com (personal landing page)
shotgun/        → shotgun.leo-ricci.com (product + support + privacy)
firebase.json   → Firebase Hosting config (multi-site)
.firebaserc     → Firebase project/target mapping (edit before deploying)
```

## Setup (one-time)

### 1. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 2. Find your Firebase project

```bash
firebase projects:list
```

Pick the project that has Hosting for `leo-ricci.com`, or create a new one.

### 3. Create a second Hosting site for the subdomain

```bash
firebase hosting:sites:create shotgun-leo-ricci --project YOUR_PROJECT_ID
```

### 4. Set up deploy targets

```bash
firebase target:apply hosting main YOUR_MAIN_SITE_ID --project YOUR_PROJECT_ID
firebase target:apply hosting shotgun shotgun-leo-ricci --project YOUR_PROJECT_ID
```

This writes to `.firebaserc` automatically. You can also edit `.firebaserc` by hand.

### 5. Add custom domain for subdomain

In Firebase Console → Hosting → shotgun-leo-ricci site → Add custom domain → `shotgun.leo-ricci.com`

Then in Squarespace Domains (your DNS), add:

```
Type:  CNAME
Host:  shotgun
Value: hosting.firebase.app
```

Firebase handles SSL automatically.

## Deploy

```bash
# Deploy both sites
firebase deploy --only hosting

# Deploy just the main site
firebase deploy --only hosting:main

# Deploy just the Shotgun site
firebase deploy --only hosting:shotgun
```

## App Store URLs

- **Support URL:** `https://shotgun.leo-ricci.com/support`
- **Privacy Policy URL:** `https://shotgun.leo-ricci.com/privacy`

## Custom email (support@leo-ricci.com)

Firebase Hosting doesn't handle email. Options:

1. **Email forwarding via Squarespace** — Squarespace Domains supports email forwarding. Set up `support@leo-ricci.com` to forward to `ldricci3@gmail.com`. This is the simplest option.

2. **Google Workspace** — Full email hosting ($6/mo). Overkill for a support address.

3. **ImprovMX** — Free email forwarding service for custom domains. Add MX records in Squarespace.
