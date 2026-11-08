# Feedback round 1: v0.2.0-alpha.2 to friends

Written 2026-11-08 by the Orchestrator. The owner is sending the game to a group or two for first impressions. This note records how feedback is captured, the message that went out, and how responses are turned into work.

## 1. How feedback is captured

- **A Google Form** with eight tap questions and one optional text box, under two minutes on a phone. Created by `docs/feedback/create-form.gs`; responses land in a linked Google Sheet.
- **A FEEDBACK item** in the game's title menu and on the results screen, right after a run. It opens the form in a new tab with the last question prefilled by the game, so testers never type their device.
- **The prefilled technical line** (`src/ui/feedback.ts`, `techSummary`) looks like:

  `v0.2.0-alpha.2 | phone | ARM, Mali-G78 MP20, OpenGL ES 3.2 | Chrome 142 Android | 838x328 @1.0 | mobile | the-table 6,767 landed 58 fps`

  Fields: version, phone or desktop, GPU, browser and OS, canvas pixels and render ratio, quality preset, then the last run's exit, score, how it ended and mean fps while flying (or `no run yet` from the title screen).

- **Configuration** is the `FEEDBACK_FORM` constant in `src/ui/feedback.ts`: the form's `viewform` URL and the `entry.<id>` of the technical-details question. With an empty URL the FEEDBACK items are hidden.

Form link and entry id: see the end of this file.

## 2. The questions

| # | Question | Type |
|---|---|---|
| 1 | How did flying feel? | 1 to 5, "Like a brick" to "Like a bird" (required) |
| 2 | How were the controls? | Easy straight away / Took a minute, then fine / Fought me the whole way |
| 3 | What did you play on? | Phone, touch / Keyboard / Mouse / Gamepad |
| 4 | Did it run smoothly? | Smooth / Occasional stutter / Choppy / Did not load |
| 5 | What was the first thing that confused you? | text |
| 6 | What did you want to do that the game would not let you? | text |
| 7 | Did you finish a run? | Landed / Crashed / Gave up / Did not get to fly |
| 8 | Would you play again? | 1 to 5 |
| 9 | Anything else? | text, optional |
| 10 | Technical details | prefilled by the game |

## 3. Message for the groups

> I made a browser game: wingsuit flying off Table Mountain, on the real terrain. Free, nothing to install, works on a phone too.
>
> https://toastseagers.github.io/table-mountain-wingsuit/
>
> Two things to try: fly The Table first, then Lion's Head. When you land (or crash), tap FEEDBACK on the results screen. It is eight quick taps and tells me what phone you were on. If it stutters, a screenshot helps.
>
> Still an early build, so be harsh. Thanks!

Shorter version for a second group:

> Wingsuit game over Table Mountain, in the browser, phone-friendly: https://toastseagers.github.io/table-mountain-wingsuit/ . Tap FEEDBACK after a run and tell me what you thought, good or bad.

### Reddit version (AI disclosure first)

Posted where the subreddit's rules allow AI-assisted work; the disclosure is the first line so nobody feels tricked. Suggested title: *I built a wingsuit game over the real Table Mountain with Claude doing the coding. Free, in the browser, honest feedback wanted.*

> **Upfront: the code was written by an AI (Claude Code). I directed it, tested it, and made the calls; I did not write the TypeScript.** If that is a dealbreaker for you, fair enough, no argument from me.
>
> What it is: a browser wingsuit game on the real Table Mountain, built from the City of Cape Town's open LiDAR contours and aerial imagery. Three launch points, a parachute, landing zones, an old-school score screen. Free, no install, no account, no ads, no tracking. Works on a phone.
>
> https://toastseagers.github.io/table-mountain-wingsuit/
>
> Where things came from, since that is the fair question: terrain and photos are the City's open data under their non-commercial terms, the sound is synthesised in code, the one font is OFL, no asset packs, nothing scraped from other games. The code is MIT on GitHub if you want to look: https://github.com/ToastSeagers/table-mountain-wingsuit
>
> What I would like to know: does it feel good to fly, do the phone controls make sense, and how it runs on your hardware. There is a FEEDBACK button on the results screen (eight taps, it fills in your device details itself), or just tell me here.
>
> The launch points are fictional. BASE jumping is prohibited in the park. Please do not try this.

### r/vibecoding version (process first, per its rule 3)

Title: *I ran Claude Code as a seven-stage studio to build a wingsuit game on the real Table Mountain. Here is the project and how I made it.*

r/vibecoding welcomes vibe-coded projects but removes link drops: the post must say which tools, what workflow, and what was learned. Rule 1 asks that the post text itself be written by a human, so the owner should rewrite this in their own words before posting; it is a skeleton with the facts filled in.

> **Here's the project:** a browser wingsuit game over the real Table Mountain. https://toastseagers.github.io/table-mountain-wingsuit/ (free, no install, works on a phone; code MIT at https://github.com/ToastSeagers/table-mountain-wingsuit)
>
> **Here's how I made it.** Claude Code in the desktop app did the coding. I did not write the TypeScript. What I did was run it like a small studio:
>
> - **One plan, many agents.** First session wrote a staged plan: terrain data, renderer, flight model, game loop and UI, audio and post-FX, QA and release, then mobile. Each stage got its own written brief, its own fresh session, its own branch, and a gate I checked before merging. Sonnet 5.5 for most stages, Opus for the renderer, Haiku for sweeps. The plan file also says which model and effort each job gets, to keep credits down.
> - **Real terrain, open data.** City of Cape Town 2 m LiDAR contours and their 2025 aerial mosaic, turned by a Python pipeline into 5 m height tiles and WebP textures, 27 MB total. Lat/lon never enters game code; it is converted once at the data boundary.
> - **Physics you can unit test.** The flight model is pure TypeScript with no Three.js import, so it runs headless: 64 tests, a CSV harness, a measured-versus-target table for glide ratio and sink against published wingsuit numbers. That caught more bugs than playing did.
> - **Autopilot as a test pilot.** A scripted pilot flies every launch point, so a terrain or exit change shows up as a crash in a terminal, not a feeling.
> - **Mobile taught me the most.** First phone build stuttered for the first minute: the preset rendered at 1.2 pixels per CSS pixel, streamed 12 chunk builds a frame and churned a 24-tile texture cache. Fix was a countdown that waits for terrain to settle, device-scaled streaming budgets, and a bigger cache. The perf overlay now prints "builds since GO" so a phone screenshot is a bug report.
> - **Local model for grunt work.** A 7B coder model through Ollama and Aider handles renames and boilerplate so the paid model does the thinking.
>
> **What I'd do differently:** the sim got good before the game had a hook, which is the exact mistake the Volo Airsport dev wrote about when shutting that project down. Next round is restart-in-one-tap, risk-weighted proximity scoring, and a Zen mode, not more physics.
>
> Feedback button is on the results screen; it fills in your device and frame rate itself. Tell me what feels wrong.

### r/playmygame version (their template)

Rules: free playable build now, platform flair added after posting, description of at least 100 words, one post a month. Posted title: *Table Mountain Wingsuit, fly a wingsuit off the real Table Mountain in your browser (free)*

> **Game Title:** Table Mountain Wingsuit
>
> **Playable Link:** https://toastseagers.github.io/table-mountain-wingsuit/
>
> **Platform:** Browser (desktop and mobile)
>
> **Description:** A wingsuit flying game set on the real Table Mountain in Cape Town. The terrain is built from the City of Cape Town's open 2 m LiDAR data and 2025 aerial photography, so the cliffs, gorges and beaches are the actual ones. You pick one of three launch points (The Table, Platteklip Gorge or Lion's Head), fly a wingsuit with a realistic 3:1 glide, pull your parachute, flare, and try to put down inside a landing zone at Camps Bay, the Glen or Sea Point. Scoring is retro arcade style: distance, air time, proximity to terrain, landing quality and style bonuses, with a high-score table and initials. A run takes about two minutes. Keyboard, mouse or gamepad on desktop; on a phone you drag to steer and tap buttons to pull and flare. The sound is synthesised, there are no accounts, ads or tracking, and the launch points are fictional placements on real geography.
>
> **Free to Play Status:** Free to play
>
> **Involvement:** Solo project. I designed it, wrote the plan and specs, chose and prepared the open terrain data, playtested every build on desktop and phone, and made the design and tuning calls. The code itself was written by an AI coding agent (Claude Code) working from my briefs, stage by stage, with me checking each one before it went in. Code is MIT on GitHub.
>
> What I would most like feedback on: does flying feel good, do the phone controls make sense without a tutorial, and does it run smoothly on your hardware. The FEEDBACK button on the results screen fills in your device and frame rate for you. I will play and comment on your games too.

Posted 2026-11-08: r/vibecoding https://www.reddit.com/r/vibecoding/comments/1xr1jyf/wingsuit_game_on_real_lidar_terrain_coded_by/ and r/SideProject.

### r/SideProject version

Rule: title "[Project name] - [Short description]".

Title: *Table Mountain Wingsuit - a free browser wingsuit game on real Cape Town terrain, built with an AI coding agent*

> Side project of the last few days. I live near Table Mountain and wanted to fly off it without the legal and mortal problems, so: a browser wingsuit game on the real terrain. City of Cape Town publishes 2 m LiDAR contours and aerial imagery as open data; a Python pipeline turns that into height tiles, Three.js draws it, and a small physics model flies a suit at a realistic 3:1 glide.
>
> https://toastseagers.github.io/table-mountain-wingsuit/ (free, no account, works on a phone)
>
> Honest part: Claude Code wrote the code. I wrote the plan, split it into stages with their own briefs and checks, tested every build, and made the decisions. Took about a week of evenings and a few hundred tests. Repo is MIT if you want to see how a multi-agent build like that is organised: https://github.com/ToastSeagers/table-mountain-wingsuit
>
> Looking for feedback on feel and on phone performance. The FEEDBACK button on the results screen prefills your device and frame rate so I can compare across hardware.

Notes for the owner when posting:

- Check each subreddit's rules on AI-generated content before posting; a removal is worse than not posting. Use an "AI-assisted" flair where one exists.
- Verified 2026-11-08: **r/capetown bans AI-generated content** (owner read the sidebar), so do not post there without a modmail reply saying a human-written post about an AI-coded game is acceptable. **r/vibecoding** allows vibe-coded projects only with tools, workflow and insights in the post (rule 3) and human-written text (rule 1); rule 2 (tool approval) is for startups. **r/playmygame** needs a free playable build, the link flair, "Title, one-line hook" and a month between posts. **r/IndieGaming** allows one post per two weeks and requires saying how generative AI was used. **r/IndieDev** has few rules and favours images and GIFs. **r/gamedev** is not a showcase. **r/webdev** is Showoff Saturday only. **r/SideProject** wants "[Project name] - [Short description]". Unverified: r/WebGames, r/threejs, r/southafrica, r/ClaudeCode, r/wingsuit, r/SkyDiving, r/BASEjumping.
- Answer specific questions, do not argue the general point. Anyone who objects on principle is not going to be a tester.
- The same disclosure can go in one line on the game's title screen later if the thread shows people want it in the product, not just the post.

### First comment acted on

A r/vibecoding commenter warned that a green check can pass without running anything (their CI only ran a secret scan on draft PRs). True of this repo in a different form: the Pages workflow only built, and the 232 tests ran by hand at each gate. Fixed the same evening: a `check` job (test, lint, typecheck, JUnit artifact) now gates the build and deploy, the README carries the workflow badge, and the first CI run found a real difference between the laptop and the runner (a terrain test over the 5 s default timeout). Reply posted to the thread.

## 4. Closing the loop

1. Every few days the Orchestrator reads the responses sheet.
2. Scale and choice questions are summarised as counts per device (phone vs desktop, from the technical line).
3. Free-text answers are clustered into themes; each theme becomes a numbered item under "Owner play notes" in `docs/status/playtest-notes.md`, with a count of how many testers raised it and the devices involved.
4. Items that are clear and small feed the next stage brief; anything that needs a design decision goes to the owner with a recommendation.
5. The version in the technical line separates feedback on this alpha from later builds; when the game changes materially, start a new section in this file.

## 5. Form details

Created 2026-11-08 under the owner's personal Google account by running `create-form.gs` in Apps Script (project "TMW feedback form").

- Form (share): https://docs.google.com/forms/d/e/1FAIpQLSdkuQYWS-0TjyvDp1n5ZK8F32SLRcFujaMprbYFxPNlooYzfA/viewform
- Edit: https://docs.google.com/forms/d/1zlJM8Sd64Kk6JpPykeBbe30_VGLMUscEj-FGioXf704/edit
- Responses sheet: https://docs.google.com/spreadsheets/d/1wGHgTNQf99P5aZxM0F4bx-KXFhY1OpX8n1cGX1rBq94/edit
- Technical-details entry id: `2086699247` (read from the live form's `FB_PUBLIC_LOAD_DATA_`; the other entry ids are 1499112870, 1004977346, 2125250359, 17471424, 323025551, 412080196, 1855824864, 928364991, 1751847362 in question order)
- No sign-in required to answer; email is not collected; multiple responses per person allowed.
