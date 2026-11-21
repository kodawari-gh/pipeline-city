# music_reactive_preview.ogg: cue list

40 s, 66 bpm (bar = 3.636 s), F Lydian -> C Lydian at level 2. Built only from the shipped stems and notes with music-spec.json rules.

| time (s) | game event (repo) | what the music does |
|---:|---|---|
| 0.00 | `Phase 'idle-os', speed 4 (1x)` | bed (F Lydian) on; nothing else yet |
| 1.20 | `note 'install' (player drag-drop)` | immediate cue pluck F4 (build register, centre); pad ducks -3 dB |
| 3.64 | `(next bar after install)` | pluck loop layer enters on the bar line |
| 5.30 | `note 'cable' connected` | rising root->5th (F4, C5), on the next beat 5.45 s |
| 6.90 | `LinkState 'link-up' + Phase 'running-os'` | shimmer (data) + bass layers in on the next bar 7.27 s |
| 9.40 | `note 'payout'` | fan of 4 chord-tone glints (F5 A5 C6 E6), 1/3-beat apart from 9.47 s |
| 10.60 | `VrmSnap.loadRatio > 1 (stress 0 -> 0.8)` | stress layer fades in over 1 bar from 10.91 s |
| 13.60 | `note 'ecc'` | tiny high glint (B6) |
| 15.60 | `stress back to 0` | stress layer fades out over 1 bar from 16.36 s |
| 16.90 | `note 'level' (level 2)` | key change queued for the next bar line 18.18 s |
| 17.30 | `popupPause: speed 0 (level-up card)` | pause hold over 1.0 s: bed -> pause bed, pluck low-passed to 850 Hz at -5 dB, bass + shimmer out. Never cuts |
| 18.18 | `(bar line) key change F -> C Lydian` | all stems crossfade F -> C over 1.4 s; music_levelup_C chord rings into the pause |
| 22.00 | `step while paused` | one quiet, darkened pluck (G4) |
| 27.80 | `dismissLevelUp -> setSpeed(lastRunSpeed)` | resume on the next beat 28.18 s: pause bed -> bed, filter opens, bass + shimmer back over 1.0 s |
| 31.50 | `note 'job' (result ready)` | single cue pluck C5 (flow register) |
| 33.20 | `note 'payout' (bigger job)` | fan of 5 chord-tone glints C5 E5 G5 B5 C6, now in the new key |
| 36.40 | `(end of preview)` | fade out |
