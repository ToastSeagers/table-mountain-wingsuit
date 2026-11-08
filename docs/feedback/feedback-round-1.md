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

## 4. Closing the loop

1. Every few days the Orchestrator reads the responses sheet.
2. Scale and choice questions are summarised as counts per device (phone vs desktop, from the technical line).
3. Free-text answers are clustered into themes; each theme becomes a numbered item under "Owner play notes" in `docs/status/playtest-notes.md`, with a count of how many testers raised it and the devices involved.
4. Items that are clear and small feed the next stage brief; anything that needs a design decision goes to the owner with a recommendation.
5. The version in the technical line separates feedback on this alpha from later builds; when the game changes materially, start a new section in this file.

## 5. Form details

- Form (share): _to be filled when the form is created_
- Edit: _to be filled_
- Responses sheet: _to be filled_
- Technical-details entry id: _to be filled_
