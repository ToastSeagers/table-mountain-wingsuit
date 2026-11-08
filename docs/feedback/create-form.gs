/**
 * Google Apps Script that builds the tester feedback form and its response sheet.
 *
 * Run once from https://script.google.com (New project, paste, Run `createFeedbackForm`, allow the
 * Forms/Sheets/Drive scopes it asks for). The log prints the public form URL. The prefill entry id of
 * the technical-details question is then read from the live form's page (see feedback-round-1.md).
 *
 * Kept in the repo so the form can be recreated or revised; it is not part of the game build.
 */
function createFeedbackForm() {
  const form = FormApp.create('Table Mountain Wingsuit: tester feedback');
  form
    .setDescription(
      'Thanks for flying. Eight quick taps and one optional text box. ' +
        'Only the first question is required. The last box is filled in by the game; leave it as it is.',
    )
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setShowLinkToRespondAgain(true)
    .setConfirmationMessage('Got it. Thanks for the feedback, go fly another one.')
    .setProgressBar(false);

  form
    .addScaleItem()
    .setTitle('How did flying feel?')
    .setBounds(1, 5)
    .setLabels('Like a brick', 'Like a bird')
    .setRequired(true);

  form
    .addMultipleChoiceItem()
    .setTitle('How were the controls?')
    .setChoiceValues(['Easy straight away', 'Took a minute, then fine', 'Fought me the whole way']);

  form
    .addMultipleChoiceItem()
    .setTitle('What did you play on?')
    .setChoiceValues(['Phone, touch', 'Laptop or desktop, keyboard', 'Laptop or desktop, mouse', 'Gamepad']);

  form
    .addMultipleChoiceItem()
    .setTitle('Did it run smoothly?')
    .setChoiceValues(['Smooth', 'Occasional stutter', 'Choppy', 'Did not load']);

  form.addParagraphTextItem().setTitle('What was the first thing that confused you?');

  form.addParagraphTextItem().setTitle('What did you want to do that the game would not let you?');

  form
    .addMultipleChoiceItem()
    .setTitle('Did you finish a run?')
    .setChoiceValues(['Landed', 'Crashed', 'Gave up', 'Did not get to fly']);

  form
    .addScaleItem()
    .setTitle('Would you play again?')
    .setBounds(1, 5)
    .setLabels('No thanks', 'Right now');

  form.addParagraphTextItem().setTitle('Anything else?');

  form
    .addTextItem()
    .setTitle('Technical details (filled in by the game, leave as is)')
    .setHelpText('Version, device, graphics chip, browser, resolution, preset, last run and frame rate.');

  const sheet = SpreadsheetApp.create('Table Mountain Wingsuit: feedback responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('Form (share this):   ' + form.getPublishedUrl());
  Logger.log('Edit:                ' + form.getEditUrl());
  Logger.log('Responses sheet:     ' + sheet.getUrl());
}
