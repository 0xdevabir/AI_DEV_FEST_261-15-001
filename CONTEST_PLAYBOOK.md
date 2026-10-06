# AI DevFest 2026 — Vibe-Coding Contest Playbook

> Source: `resources/AI_DevFest_Vibe_Coding_Rulebook.pdf` (all 13 sections). Section numbers like **§5.1** point back to the rulebook.
> Contest: **6 Oct 2026, 3:30 PM – 5:30 PM** · Results: **7 Oct 2026, 2:00 PM** · DIU, organized by CPC.

---

## 0. The 10 Commandments (read this if nothing else)

1. **Frontend only.** No backend, no serverless functions, no Firebase/Supabase/Appwrite as storage. Persistence = `localStorage` / `IndexedDB` only. (§5.1)
2. **Zero code before T+0.** Only README + MIT LICENSE in the repo during setup. No templates, no old projects. (§5.3, §8.1, §8.2)
3. **Repo name:** `devfest-<registration-number>`, **public**. (§8.1)
4. **Commit ≥ every 30 min, ≥ 3 commits total.** Every message = *what changed* + *the prompt used* (or `Manual edit`). (§8.3, §8.4)
5. **Never rewrite history.** No `--force`, no rebase of pushed commits, no repo delete. (§8.5)
6. **Bangla + English** for ALL labels, buttons, messages, instructions — with a language switch. (§5.6)
7. **Live HTTPS site by T+90**, opens in latest Chrome with no login/install, and **matches the final commit**. (§5.7, §10)
8. **No secrets anywhere** — not in code, not in the live site, not in old commits. AI features require the *user* to paste their own key. (§5.5, §5.8)
9. **Main features must work without AI and without any external API.** (§5.4, §5.5)
10. **Hard stop at T+90.** Code, commits, pushes and deploys freeze. T+90→T+95 is form-only with **−10 marks**. After T+95: not accepted. (§8.6, §9.4)

---

## 1. Timeline & What To Do When

| Time | Rule | My action |
|---|---|---|
| **Setup (30 min, before T+0)** | Log in, create repo, confirm push works. Problem not shown yet. | See §2 checklist below. |
| **T+0** | Problem + requirements + sample data given. | Read the WHOLE problem. Separate **main** vs **bonus** tasks. |
| **T+0 → T+15** | Only window for questions to organizers. (§4.3) | Ask about anything ambiguous *immediately*. After T+15 no questions. |
| **~T+10** | — | Scaffold (e.g. `npm create vite@latest`), deploy a "hello" build to confirm hosting works. **Commit #1.** |
| **≤ T+30** | Commit required (30-min rule). | Main task skeleton + i18n wired. **Commit #2 + deploy.** |
| **≤ T+60** | Commit required. | All main tasks working. **Commit #3 + deploy.** |
| **T+60 → T+75** | — | Bonus tasks, polish, README. Commit + deploy. |
| **T+75 → T+85** | — | **Feature freeze.** Final README, final commit, final deploy, verify live link in Chrome incognito. |
| **T+85 → T+90** | Submit by T+90 for on-time. | Copy commit SHA, **submit the form**. |
| **T+90** | **Everything stops.** | Hands off keyboard for code/git/deploy. |
| T+90 → T+95 | Form only, −10 marks. | Only if absolutely necessary. |

> No extra time if your AI tool hits a limit (§6.2) or for personal laptop/hotspot problems (§7.7). Extra time is only possible for a *verified* problem with organizer-provided PC/internet — report it immediately.

---

## 2. Pre-Contest Setup Checklist (the 30-min setup)

- [ ] ID card / registration confirmation in hand. (§2.4)
- [ ] GitHub login works; phone ready for 2FA codes.
- [ ] AI tools logged in (check usage limits/quota beforehand — no extra time if they run out).
- [ ] Create **new public** repo `devfest-<registration-number>` — **not** from a template.
- [ ] Add only `README.md` + `LICENSE` (MIT). **No project code.**
- [ ] Clone, make a trivial push to confirm auth works.
- [ ] Log in to hosting (Vercel / Netlify / Cloudflare Pages / GitHub Pages) and know how to connect the repo.
- [ ] Node/npm present on the machine (if using Vite/React etc.).
- [ ] If using own laptop: **bring your own backup internet** (hotspot). (§7.1)
- [ ] Prepare prompts in your head, not in files — pre-written code/templates are forbidden.

---

## 3. Technical Rules — Allowed vs Forbidden

### ✅ Allowed
- Any framework or none: plain HTML/CSS/JS, React, Vue, Svelte, Angular… (§5.2)
- Open-source libraries via npm or CDN; official starters like `create-vite`. (§5.2)
- Browser storage: `localStorage`, `sessionStorage`, `IndexedDB`. (§5.1)
- Static hosting: GitHub Pages, Vercel, Netlify, Cloudflare Pages. (§10.1)
- External/public APIs that are **HTTPS + CORS-enabled**, called directly from the browser. (§5.4)
- AI features inside the app — **only** with a user-entered API key. (§5.5)
- Any AI coding tool(s), free or paid; agents may create files and run git. (§6)

### ❌ Forbidden (→ disqualification risk)
- Your own backend / server code / **serverless functions** (so no Vercel/Netlify functions, no API routes, no Next.js server actions). (§5.1)
- Firebase, Supabase, Appwrite or any participant-controlled DB/storage. (§5.1)
- Using an external API *as* your database/storage layer. (§5.4)
- Hard-coded API keys / tokens / passwords — anywhere, ever (including `.env` committed, or bundled into the build). (§5.8, §10.3)
- Code written before the contest, own templates, old projects, other people's code. (§5.3)
- Real personal data or private company data — use only the **provided sample data**. (§11.3)

### Technical design rules I will follow
- **Static build only.** For Vite: `vite build` → `dist/`. If using Next.js, it must be `output: 'export'` (pure static) — simpler to just use Vite.
- **Graceful degradation:** wrap every external API call in try/catch with a fallback UI; core features must work offline from the API. (§5.4)
- **AI key UX:** a settings field "Your API key / আপনার API কী" stored in `localStorage` only on the user's device; app fully works if left empty. (§5.5)
- **i18n from minute one:** a single `translations = { en: {...}, bn: {...} }` object + `t(key)` helper + EN/বাংলা toggle (persist choice in `localStorage`). Never hard-code UI strings. Include Bangla font (e.g. *Noto Sans Bengali* / *Hind Siliguri* from Google Fonts). Consider Bangla numerals (`toLocaleString('bn-BD')`) for polish.
- **Data persistence:** `localStorage` with JSON; add import/export (JSON/CSV) if the problem involves records — judges love it and it fits the "no backend" rule.
- **Sample data:** load the organizer-provided sample data (bundle it into the app, or provide a "Load sample data" button).
- **Output files:** if the problem asks for output files (CSV/JSON/report), commit them to the repo too. (§9.2)
- **Test in latest Google Chrome**, incognito, on the deployed URL — that's what judges use. (§5.7)
- Check `.gitignore` includes `node_modules`, `.env*`.

---

## 4. Git & Commit Rules (judges read your history)

- **Cadence:** ≥ 1 commit every 30 min, ≥ 3 total. Aim for ~5–8 meaningful commits. (§8.3)
- **Message format** (every commit — what changed + prompt, or `Manual edit`; Bangla or English OK). (§8.4)

```
feat: add employee list with search and filter

Prompt: "Create a React component that lists employees from sample.json
with a search box and department filter, all labels via t() in EN and BN"
```

```
fix: Bangla font not loading on mobile

Manual edit
```

- If an AI agent commits for me, I make sure it writes the prompt in the message.
- **Never:** `git push --force`, `git rebase` on pushed commits, `git commit --amend` after push, deleting/recreating the repo. (§8.5)
- **Final eligible commit** must be *created and pushed* by T+90. Only that SHA + its deployment are judged. (§8.6)
- Before every commit: quick scan for secrets (`git diff --staged | grep -iE "key|token|secret|password"`).

---

## 5. Deployment Rules (compulsory, no bonus marks — but missing it is fatal)

- Public **HTTPS** URL, opens on judge's device **without login or install**. (§10.2)
- Must **run the main features**.
- Must **match the final eligible commit** — deploy from the repo (auto-deploy on push via Vercel/Netlify/Cloudflare), then confirm the deployed commit SHA = final SHA.
- **No deployment changes after T+90.** Turn off nothing / redeploy nothing after.
- Keep it live **until results are published (7 Oct)**. Don't delete the project, don't let a preview link expire — submit the **production** URL, not a preview URL.
- Deploy early (by ~T+10) so hosting surprises (SPA routing 404s, base path on GitHub Pages) are found early.
  - GitHub Pages + Vite → set `base: '/devfest-<reg-no>/'`.
  - SPA routing → prefer hash routing or a single page to avoid 404s on refresh.

---

## 6. Submission (official form, by T+90)

Form fields (§9.1):
- [ ] Full name + registration number
- [ ] Repository link
- [ ] Final commit ID (full SHA or first 7 chars) → `git rev-parse HEAD`
- [ ] Public HTTPS live link

Repository must contain (§9.2):
- [ ] All source code
- [ ] `README.md` (contents below)
- [ ] Any output files the problem asks for
- [ ] `LICENSE` with MIT License text

### README.md must include (§9.3) — template

```markdown
# <App Name>

**Name:** <Full name> · **Registration No:** <reg-no>
**Live:** https://<your-live-url>

## How to run
npm install
npm run dev      # local
npm run build    # production build → dist/

## Main features (done)
- ...

## Bonus features
- ...

## Known problems
- ...

## AI tools used
- ...

## Most useful prompt
> "..."
```

> Fill README **before** the final commit — editing it after T+90 is a code change and is not allowed.

---

## 7. How To Win (strategy derived from the rules)

The rulebook doesn't publish a scoring rubric, but judging is "against the contest requirements" on the **final commit + live deployment** (§3). So:

1. **Main tasks first, 100%.** Bonus tasks only after every main task works on the live site. (§4.4) A half-done bonus is worth less than a polished main.
2. **Map requirements → checklist at T+5.** Write each main/bonus requirement as a line in README; tick them as done. Makes judging easy and the README "Main features / Bonus features" section writes itself.
3. **Ask smart questions in T+0–T+15.** Clarify ambiguous input formats, expected output, and what "done" means. This is the only chance.
4. **Use the sample data exactly.** Make the app load it out-of-the-box so the judge sees a populated, working app instantly — no empty screen.
5. **Bilingual done properly** = visible score. Toggle in the header, everything translates (including validation errors, empty states, toasts, dates/numbers), Bangla font renders cleanly.
6. **"Useful for an organization"** — think real workflows: search, filter, sort, add/edit/delete, summary stats/dashboard, export (CSV/PDF/print), validation, empty states, confirmation dialogs.
7. **Robustness:** no console errors, works after page refresh (localStorage), handles bad input, responsive on mobile (judge's own device!).
8. **Clean, simple UI.** A neat UI library (Tailwind, Pico, shadcn, etc. via npm/CDN) is fine. Consistent spacing, clear headings, good contrast.
9. **Optional AI feature as a bonus** (e.g. "summarize / suggest" with user-entered key) — only if main is done; must be fully optional.
10. **Deploy early, deploy often.** Every commit = a deploy. Never be in a state where the live site is broken near T+90.
11. **Be able to explain your code** — judges may ask how it works (§6.4). Keep architecture simple: few files, clear names.
12. **Commit history tells a story:** steady progress, honest prompts, no giant single dump at the end.

---

## 8. Conduct & Lab Rules (DQ traps)

- Solo: **no talking/messaging anyone** except organizers — no chat apps, email, social media, remote access. (§7.4)
- Phone: **only** for 2FA and as hotspot. Not for AI, coding, messages, or calls. (§7.2)
- No unauthorized USB/external storage devices. (§12)
- Don't disable security software, open others' files, or disturb other PCs/network. (§7.5)
- Don't copy from or share code with other participants. (§12)
- Use only organizer sample data — no real personal data. (§11.3)
- Respect licenses of libraries, fonts, images used. (§11.2)
- **After finishing: log out of GitHub, AI tools, email; close the browser.** (§7.6)
- Contact: cpc@diu.edu.bd · 01768804069. Rules may change during the event — listen for announcements. (§13)

---

## 9. Final 10-Minute Checklist (T+80)

- [ ] All main tasks work on the **live URL** in Chrome **incognito**.
- [ ] Language toggle: every visible string switches EN ⇄ বাংলা.
- [ ] Works with the provided sample data; refresh keeps data.
- [ ] No API keys / secrets in repo, build output, or live site.
- [ ] App works with external APIs / AI disabled.
- [ ] README complete (name, reg no, live link, run steps, features, bonus, known problems, AI tools, best prompt).
- [ ] `LICENSE` (MIT) present; required output files committed.
- [ ] Final commit message has description + prompt.
- [ ] `git push` done, `git status` clean, `git log origin/main -1` = local HEAD.
- [ ] Hosting dashboard shows deployment of that exact SHA, status = Ready.
- [ ] Submit form with repo link, SHA, live link — **before T+90**.
- [ ] Hands off. Then log out of everything.
