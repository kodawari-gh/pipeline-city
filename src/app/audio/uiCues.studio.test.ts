// Ticket #66: the UI cues the two studios use, as the data-cue mapping gives them (uiCues.ts, pure). The studios name their
// cues in data-cue, so the mapping decides what a tag, a flyout, the Gallery turntable and a transition play.
// Covers: category tags and Gallery spine (tab switch), Gallery part arrows (value change), the flyout's open marker
// (silent) and its close (panel close), the Gallery turntable (silent click, hover still plays), the studio enter
// (click then transition), Esc (back), and that each cue id the studios name exists in the cue table.
import { describe, expect, it } from 'vitest';
import { clickSteps, isCueId, uiCueFor, NEXT_DELAY_S } from './uiCues';

describe('studio: tags, spine and part arrows', () => {
  it('a category tag or the Gallery spine plays the tab switch on click', () => {
    expect(uiCueFor('click', 'ui_tab_switch')).toBe('ui_tab_switch');
  });

  it('the Gallery part arrows play the value change on the arrow keys', () => {
    expect(uiCueFor('value', 'ui_value_change')).toBe('ui_value_change');
  });

  it('focus moves between tags play the focus cue', () => {
    expect(uiCueFor('focus', 'ui_tab_switch')).toBe('ui_focus_move');
  });
});

describe('studio: flyout and close', () => {
  it('the flyout open marker plays nothing on click (the open cue comes from the panel rule)', () => {
    expect(uiCueFor('click', 'ui_panel_open')).toBeNull();
  });

  it('the flyout close button plays the panel close cue', () => {
    expect(uiCueFor('click', 'ui_panel_close')).toBe('ui_panel_close');
  });
});

describe('studio: the Gallery turntable is silent', () => {
  it('a click on a silent element plays nothing', () => {
    expect(uiCueFor('click', 'silent')).toBeNull();
  });

  it('a silent element still plays hover and focus', () => {
    expect(uiCueFor('hover', 'silent')).toBe('ui_hover');
    expect(uiCueFor('focus', 'silent')).toBe('ui_focus_move');
  });
});

describe('studio: entering a studio', () => {
  it('the Build my PC or Gallery button plays its click, then the transition 70 ms later', () => {
    expect(clickSteps('ui_click', 'ui_transition_in')).toStrictEqual([
      { id: 'ui_click', delayS: 0 },
      { id: 'ui_transition_in', delayS: NEXT_DELAY_S },
    ]);
  });
});

describe('studio: Esc', () => {
  it('Esc plays the back cue wherever the focus is', () => {
    expect(uiCueFor('back', null)).toBe('ui_back');
  });
});

describe('studio: the cue ids the issue names exist in the cue table', () => {
  it.each([
    'install',
    'uninstall',
    'cable_connect',
    'cable_disconnect',
    'power_on',
    'power_off',
    'speed_up',
    'speed_down',
    'job_fulfilled',
    'ui_confirm',
    'ui_click',
    'ui_tab_switch',
    'ui_value_change',
    'ui_panel_open',
    'ui_panel_close',
    'ui_pickup',
    'ui_transition_in',
    'ui_hover',
    'ui_focus_move',
  ])('%s is a cue', (id) => {
    expect(isCueId(id)).toBe(true);
  });
});
