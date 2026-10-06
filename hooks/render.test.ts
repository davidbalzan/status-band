import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'status-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band draws a placeholder before any response', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /Cache timer/ })).toBeDefined()
  await ui.unmount()
})

test('the band draws the countdown after a response', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 60 })
  await clock.settle()
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /until prompt cache expires/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4:00/ })).toBeDefined()
  await ui.unmount()
})
