# Publishing Checklist for Video Speed Controller Pro

Use this checklist to ensure you have everything ready before submitting to browser extension stores.

## ✅ Pre-Publication Requirements

### Documentation
- [x] README.md is complete and up-to-date
- [x] PRIVACY_POLICY.md created and comprehensive
- [x] LICENSE file present (MIT License)
- [x] Changelog maintained in README
- [ ] Support contact information added to README
- [ ] GitHub repository URL added to README (if applicable)

### Code Quality
- [x] Extension works on Chrome/Edge/Brave
- [x] Extension works on Firefox
- [x] No console errors
- [x] All features tested
- [ ] Code is commented where necessary
- [ ] No hardcoded sensitive data

### Manifest Requirements
- [x] `manifest.json` has all required fields
- [x] Version number is set (currently: 1.3.0)
- [x] Icons are present (16px, 48px, 128px)
- [x] Firefox ID is set (`video-speed-controller@extension`)
- [x] Permissions are minimal and justified
- [x] Description is clear and accurate

## 📦 Chrome Web Store Submission

### Required Information
- [ ] **Extension Name:** Video Speed Controller Pro
- [ ] **Short Description:** (80 characters max)
  - Suggested: "Speed up or slow down videos on YouTube, Netflix & any site. Volume boost, screenshots, A-B loop, filters & hotkeys."
- [ ] **Detailed Description:** (Use content from README)
- [ ] **Category:** Productivity or Entertainment
- [ ] **Language:** English (and others if applicable)
- [ ] **Privacy Policy URL:** 
  - Option 1: Host PRIVACY_POLICY.md on GitHub Pages
  - Option 2: Create a simple webpage with the policy
  - Option 3: Use a service like GitHub Gist or similar
- [ ] **Support URL:** (GitHub Issues page or support email)
- [ ] **Homepage URL:** (GitHub repository URL)

### Assets Required
- [ ] **Small Promotional Tile:** 440x280 pixels
  - Should showcase the extension's main features
  - Include text: "Video Speed Controller Pro"
- [ ] **Screenshots:** At least 1, up to 5
  - Recommended sizes: 1280x800 or 640x400
  - Should show:
    1. Extension popup/settings
    2. Controller overlay on a video
    3. Full mode controller panel
    4. Minimal mode badge
    5. Features like A-B loop, filters, etc.
- [ ] **Marquee Promotional Tile:** 920x680 pixels (optional but recommended)
- [ ] **Icon:** Already have 16px, 48px, 128px ✓

### Store Listing Details
- [ ] **Promotional Images:** Create eye-catching visuals
- [ ] **Feature List:** Highlight key features
- [ ] **What's New:** Describe v1.3.0 features
- [ ] **Tags/Keywords:** 
  - video speed, playback speed, youtube speed, video controller, video player, speed control, video filters, volume boost

### Chrome Web Store Specific
- [ ] **Developer Account:** 
  - One-time $5 registration fee required
  - Sign up at: https://chrome.google.com/webstore/devconsole
- [ ] **Content Rating:** Complete questionnaire
- [ ] **Single Purpose:** Extension has a clear, single purpose ✓
- [ ] **User Data:** Declare no data collection ✓
- [ ] **Permissions Justification:** Explain why each permission is needed

### Submission Steps
1. [ ] Create Chrome Web Store developer account ($5 fee)
2. [ ] Zip the extension folder (excluding .git, node_modules, etc.)
3. [ ] Upload to Chrome Web Store Developer Dashboard
4. [ ] Fill out store listing form
5. [ ] Upload screenshots and promotional images
6. [ ] Add privacy policy URL
7. [ ] Submit for review
8. [ ] Wait for review (typically 1-3 business days)

## 🦊 Firefox Add-ons (AMO) Submission

### Required Information
- [ ] **Add-on Name:** Video Speed Controller Pro
- [ ] **Summary:** (1024 characters max)
- [ ] **Description:** (Use content from README)
- [ ] **Privacy Policy URL:** (Same as Chrome Web Store)
- [ ] **Support URL:** (GitHub Issues or email)
- [ ] **Homepage URL:** (GitHub repository)

### Assets Required
- [ ] **Icon:** 48x48 and 96x96 pixels (can use existing 48px, scale to 96px)
- [ ] **Screenshots:** At least 1, recommended 3-5
  - Recommended size: 1200x675 pixels
  - Same content as Chrome screenshots

### Firefox Specific
- [ ] **Developer Account:** Free, sign up at https://addons.mozilla.org/developers/
- [ ] **Source Code:** 
  - Option 1: Link to GitHub repository
  - Option 2: Upload source code archive
- [ ] **Manifest V3 Compatibility:** ✓ Already using MV3
- [ ] **Content Security Policy:** Review and ensure compliance
- [ ] **Permissions:** Justify each permission

### Submission Steps
1. [ ] Create Firefox Add-ons developer account (free)
2. [ ] Prepare source code (if not linking to GitHub)
3. [ ] Upload extension package
4. [ ] Fill out listing information
5. [ ] Upload screenshots
6. [ ] Add privacy policy URL
7. [ ] Submit for review
8. [ ] Wait for review (typically 1-7 days, can be longer)

## 🌐 Edge Add-ons (Microsoft Edge Add-ons)

### Required Information
- [ ] **Extension Name:** Video Speed Controller Pro
- [ ] **Description:** (Use content from README)
- [ ] **Privacy Policy URL:** (Same as other stores)
- [ ] **Support URL:** (GitHub Issues or email)

### Assets Required
- [ ] **Screenshots:** Similar to Chrome Web Store
- [ ] **Promotional Images:** Similar to Chrome

### Edge Specific
- [ ] **Developer Account:** Free, uses Microsoft account
- [ ] **Can import from Chrome Web Store:** If already published on Chrome, can import listing

### Submission Steps
1. [ ] Create Microsoft Partner Center account (free)
2. [ ] Submit extension (or import from Chrome Web Store)
3. [ ] Fill out listing
4. [ ] Submit for review

## 📋 General Checklist

### Before Submission
- [ ] Test extension on clean browser profile
- [ ] Test all features work correctly
- [ ] Verify no console errors
- [ ] Check that privacy policy is accessible
- [ ] Ensure all URLs in README/manifest are correct
- [ ] Remove any debug code or console.logs (or keep minimal)
- [ ] Verify extension ID is set for Firefox
- [ ] Test on multiple websites (YouTube, Netflix, Vimeo, etc.)

### Privacy & Compliance
- [x] Privacy policy created
- [ ] Privacy policy hosted and accessible via URL
- [x] No data collection (verified in code)
- [x] Minimal permissions requested
- [ ] Permissions justified in store listing

### Marketing & Promotion
- [ ] Screenshots created and optimized
- [ ] Promotional images created
- [ ] Store listing description is compelling
- [ ] Keywords/tags selected for discoverability
- [ ] Consider creating a demo video (optional)

### Post-Submission
- [ ] Monitor review status
- [ ] Respond to any reviewer questions promptly
- [ ] Address any rejection reasons
- [ ] Prepare for user feedback
- [ ] Set up issue tracking (GitHub Issues)
- [ ] Consider creating a website/landing page (optional)

## 🔗 Useful Links

- **Chrome Web Store Developer Dashboard:** https://chrome.google.com/webstore/devconsole
- **Firefox Add-ons Developer Hub:** https://addons.mozilla.org/developers/
- **Edge Add-ons Developer Portal:** https://partner.microsoft.com/dashboard/microsoftedge
- **Chrome Web Store Policies:** https://developer.chrome.com/docs/webstore/program-policies/
- **Firefox Add-on Policies:** https://extensionworkshop.com/documentation/publish/add-on-policies/

## 📝 Notes

### Privacy Policy Hosting Options:
1. **GitHub Pages:** Free, easy setup
   - Create a `docs` folder, add PRIVACY_POLICY.md
   - Enable GitHub Pages in repo settings
   - URL: `https://yourusername.github.io/repo-name/PRIVACY_POLICY.html`

2. **GitHub Gist:** Simple, free
   - Create a gist with the privacy policy
   - Use the raw gist URL

3. **Simple Webpage:** Host on any web server
   - Convert markdown to HTML
   - Upload to your web hosting

### Version Numbering:
- Use semantic versioning: MAJOR.MINOR.PATCH
- Current version: 1.3.0
- For updates, increment appropriately:
  - Bug fixes: 1.3.1
  - New features: 1.4.0
  - Breaking changes: 2.0.0

### Support Email:
- Consider creating a dedicated email: `video-speed-pro@yourdomain.com`
- Or use a GitHub contact form
- Or just use GitHub Issues for support

---

**Last Updated:** January 2025

Good luck with your submission! 🚀
